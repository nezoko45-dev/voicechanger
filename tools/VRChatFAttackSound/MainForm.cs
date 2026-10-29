using System.Runtime.InteropServices;
using NAudio.Wave;

namespace VRChatFAttackSound;

public sealed class MainForm : Form
{
    private readonly TextBox _fileBox = new() { ReadOnly = true, Width = 320 };
    private readonly ComboBox _deviceBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 340 };
    private readonly Button _browseButton = new() { Text = "Choose attack sound…", AutoSize = true };
    private readonly Button _startButton = new() { Text = "Start F-key listener", AutoSize = true, Height = 34 };
    private readonly Button _stopButton = new() { Text = "Stop", Width = 100, Height = 34, Enabled = false };
    private readonly TrackBar _volume = new() { Minimum = 0, Maximum = 100, Value = 80, TickFrequency = 10, Width = 250 };
    private readonly Label _volumeLabel = new() { AutoSize = true, Text = "80%" };
    private readonly Label _status = new() { AutoSize = true, Text = "Choose your custom attack sound first." };
    private readonly System.Windows.Forms.Timer _pollTimer = new() { Interval = 15 };

    private string? _wavPath;
    private WaveOutEvent? _output;
    private LoopStream? _loop;
    private bool _running;
    private bool _fWasDown;

    public MainForm()
    {
        Text = "VRChat F-Key Attack Sound";
        Width = 570;
        Height = 330;
        MinimumSize = new Size(570, 330);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16),
            ColumnCount = 2,
            RowCount = 7
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 115));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Controls.Add(layout);

        layout.Controls.Add(new Label { Text = "Attack sound", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 0);
        var fileRow = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Dock = DockStyle.Fill };
        fileRow.Controls.Add(_fileBox);
        fileRow.Controls.Add(_browseButton);
        layout.Controls.Add(fileRow, 1, 0);

        layout.Controls.Add(new Label { Text = "Audio output", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 1);
        layout.Controls.Add(_deviceBox, 1, 1);

        layout.Controls.Add(new Label { Text = "Volume", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 2);
        var volRow = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Dock = DockStyle.Fill };
        volRow.Controls.Add(_volume);
        volRow.Controls.Add(_volumeLabel);
        layout.Controls.Add(volRow, 1, 2);

        var buttons = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
        buttons.Controls.Add(_startButton);
        buttons.Controls.Add(_stopButton);
        layout.Controls.Add(buttons, 1, 3);

        layout.Controls.Add(_status, 0, 4);
        layout.SetColumnSpan(_status, 2);

        var help = new Label
        {
            AutoSize = true,
            MaximumSize = new Size(510, 0),
            Text = "Press and hold F to loop your selected attack sound. Releasing F immediately pauses the sound and rewinds it, ready for the next press. F is detected globally, so VRChat can stay focused. Choose your Voicemeeter or virtual-cable playback device to route it into VRChat."
        };
        layout.Controls.Add(help, 0, 5);
        layout.SetColumnSpan(help, 2);

        _browseButton.Click += (_, _) => Browse();
        _startButton.Click += (_, _) => StartListener();
        _stopButton.Click += (_, _) => StopListener();
        _volume.ValueChanged += (_, _) =>
        {
            _volumeLabel.Text = $"{_volume.Value}%";
            if (_output != null) _output.Volume = _volume.Value / 100f;
        };
        _pollTimer.Tick += (_, _) => PollKey();
        LoadDevices();
        FormClosing += (_, _) => StopListener();
    }

    private void LoadDevices()
    {
        for (int i = 0; i < WaveOut.DeviceCount; i++)
        {
            var caps = WaveOut.GetCapabilities(i);
            _deviceBox.Items.Add(new AudioDevice(i, caps.ProductName));
        }

        if (_deviceBox.Items.Count > 0)
        {
            int preferred = 0;
            for (int i = 0; i < _deviceBox.Items.Count; i++)
            {
                var item = (AudioDevice)_deviceBox.Items[i]!;
                if (item.Name.Contains("CABLE Input", StringComparison.OrdinalIgnoreCase) ||
                    item.Name.Contains("Voicemeeter Input", StringComparison.OrdinalIgnoreCase))
                {
                    preferred = i;
                    break;
                }
            }
            _deviceBox.SelectedIndex = preferred;
        }
        else
        {
            _status.Text = "No playback devices found.";
        }
    }

    private void Browse()
    {
        using var dialog = new OpenFileDialog
        {
            Title = "Choose your custom attack sound",
            Filter = "Supported audio|*.wav;*.mp3;*.m4a;*.aac;*.wma|All files|*.*",
            CheckFileExists = true
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;

        _browseButton.Enabled = false;
        _status.Text = "Converting audio to standard WAV…";
        try
        {
            string outputDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "VRChatFAttackSound", "Converted");
            Directory.CreateDirectory(outputDirectory);
            string outputPath = Path.Combine(outputDirectory,
                $"{Path.GetFileNameWithoutExtension(dialog.FileName)}-converted.wav");

            using (var reader = new MediaFoundationReader(dialog.FileName))
            using (var resampler = new MediaFoundationResampler(reader, new WaveFormat(44100, 16, 2)))
            {
                resampler.ResamplerQuality = 60;
                WaveFileWriter.CreateWaveFile(outputPath, resampler);
            }

            _wavPath = outputPath;
            _fileBox.Text = Path.GetFileName(dialog.FileName) + " → WAV";
            _status.Text = "Attack sound ready. Click Start F-key listener.";
        }
        catch (Exception ex)
        {
            _wavPath = null;
            _fileBox.Clear();
            _status.Text = "Audio conversion failed.";
            MessageBox.Show(this,
                "Windows couldn't decode this file. Try WAV, MP3, M4A, AAC, or WMA.\n\n" + ex.Message,
                "Conversion failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _browseButton.Enabled = true;
        }
    }

    private void StartListener()
    {
        if (string.IsNullOrWhiteSpace(_wavPath) || !File.Exists(_wavPath))
        {
            MessageBox.Show(this, "Choose an attack sound first.", "Audio required",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (_deviceBox.SelectedItem is not AudioDevice device)
        {
            MessageBox.Show(this, "Choose an audio output device.", "Output required",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        try
        {
            _loop = new LoopStream(new AudioFileReader(_wavPath));
            _output = new WaveOutEvent
            {
                DeviceNumber = device.Index,
                Volume = _volume.Value / 100f,
                DesiredLatency = 80
            };
            _output.Init(_loop);
            _output.Pause();
            _loop.Position = 0;

            _running = true;
            _fWasDown = false;
            _pollTimer.Start();
            _startButton.Enabled = false;
            _stopButton.Enabled = true;
            _browseButton.Enabled = false;
            _deviceBox.Enabled = false;
            _status.Text = "Listening globally for F… hold F to play.";
        }
        catch (Exception ex)
        {
            DisposeAudio();
            MessageBox.Show(this, "Couldn't start audio playback.\n\n" + ex.Message,
                "Audio error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void PollKey()
    {
        if (!_running) return;
        bool fDown = (GetAsyncKeyState(0x46) & 0x8000) != 0; // VK_F

        if (fDown == _fWasDown) return;
        _fWasDown = fDown;

        if (fDown)
        {
            try
            {
                if (_loop != null) _loop.Position = 0;
                _output?.Play();
                _status.Text = "F held — attack sound looping.";
            }
            catch (Exception ex)
            {
                _status.Text = "Playback error: " + ex.Message;
            }
        }
        else
        {
            StopLoop();
            _status.Text = "F released — sound stopped.";
        }
    }

    private void StopListener()
    {
        _running = false;
        _pollTimer.Stop();
        StopLoop();
        DisposeAudio();
        _startButton.Enabled = true;
        _stopButton.Enabled = false;
        _browseButton.Enabled = true;
        _deviceBox.Enabled = true;
        _status.Text = "Stopped.";
    }

    private void StopLoop()
    {
        try { _output?.Pause(); } catch { }
        if (_loop != null)
        {
            try { _loop.Position = 0; } catch { }
        }
    }

    private void DisposeAudio()
    {
        try { _output?.Stop(); } catch { }
        _output?.Dispose();
        _output = null;
        _loop?.Dispose();
        _loop = null;
    }

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    private sealed record AudioDevice(int Index, string Name)
    {
        public override string ToString() => Name;
    }

    private sealed class LoopStream : WaveStream
    {
        private readonly WaveStream _source;
        public LoopStream(WaveStream source) => _source = source;
        public override WaveFormat WaveFormat => _source.WaveFormat;
        public override long Length => long.MaxValue;
        public override long Position
        {
            get => _source.Position;
            set => _source.Position = value;
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            int total = 0;
            while (total < count)
            {
                int read = _source.Read(buffer, offset + total, count - total);
                if (read == 0)
                {
                    _source.Position = 0;
                    read = _source.Read(buffer, offset + total, count - total);
                    if (read == 0) break;
                }
                total += read;
            }
            return total;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) _source.Dispose();
            base.Dispose(disposing);
        }
    }
}
