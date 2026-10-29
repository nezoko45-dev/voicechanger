using System.Diagnostics;
using System.Runtime.InteropServices;
using NAudio.Wave;

namespace VRChatAutoFootsteps;

public sealed class MainForm : Form
{
    private readonly TextBox _fileBox = new() { ReadOnly = true, Width = 340 };
    private readonly ComboBox _deviceBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 340 };
    private readonly Button _browseButton = new() { Text = "Choose audio…", AutoSize = true };
    private readonly Button _startButton = new() { Text = "Start", Width = 100, Height = 34 };
    private readonly Button _stopButton = new() { Text = "Stop", Width = 100, Height = 34, Enabled = false };
    private readonly Label _status = new() { AutoSize = true, Text = "Choose an audio file. It will be converted to standard WAV automatically." };
    private readonly TrackBar _volume = new() { Minimum = 0, Maximum = 100, Value = 75, TickFrequency = 10, Width = 250 };
    private readonly Label _volumeLabel = new() { AutoSize = true, Text = "75%" };
    private readonly System.Windows.Forms.Timer _pollTimer = new() { Interval = 35 };

    private string? _wavPath;
    private WaveOutEvent? _output;
    private LoopStream? _loop;
    private bool _moving;
    private bool _running;
    private bool _fastMode;
    private DateTime _lastStatus = DateTime.MinValue;

    public MainForm()
    {
        Text = "VRChat Auto Footsteps";
        Width = 560;
        Height = 390;
        MinimumSize = new Size(560, 390);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16),
            ColumnCount = 2,
            RowCount = 8,
            AutoSize = false
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 115));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Controls.Add(layout);

        layout.Controls.Add(new Label { Text = "Audio file", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 0);
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
            MaximumSize = new Size(500, 0),
            Text = "Selected audio is converted to standard 44.1 kHz, 16-bit PCM WAV automatically. While VRChat is the active window, holding W/A/S/D or an arrow key starts the footsteps loop. Releasing movement keys stops it. Select your virtual cable or Voicemeeter playback device to route the sound into VRChat's microphone."
        };
        layout.Controls.Add(help, 0, 5);
        layout.SetColumnSpan(help, 2);

        var note = new Label
        {
            AutoSize = true,
            ForeColor = Color.DimGray,
            MaximumSize = new Size(500, 0),
            Text = "Hold Shift while moving in VRChat to make the footsteps play faster (about 1.5×, with a higher pitch). This detects keyboard movement input, not actual avatar position."
        };
        layout.Controls.Add(note, 0, 6);
        layout.SetColumnSpan(note, 2);

        _browseButton.Click += (_, _) => Browse();
        _startButton.Click += (_, _) => StartDetection();
        _stopButton.Click += (_, _) => StopDetection();
        _volume.ValueChanged += (_, _) =>
        {
            _volumeLabel.Text = $"{_volume.Value}%";
            if (_output != null) _output.Volume = _volume.Value / 100f;
        };
        _pollTimer.Tick += (_, _) => PollMovement();
        LoadDevices();

        FormClosing += (_, _) => StopDetection();
    }

    private void LoadDevices()
    {
        _deviceBox.Items.Clear();
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
            Title = "Choose a footsteps sound",
            Filter = "WAV audio (*.wav)|*.wav",
            CheckFileExists = true
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;

        _browseButton.Enabled = false;
        _status.Text = "Converting audio to standard WAV…";
        try
        {
            string outputDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "VRChatAutoFootsteps", "Converted");
            Directory.CreateDirectory(outputDirectory);

            string baseName = Path.GetFileNameWithoutExtension(dialog.FileName);
            string outputPath = Path.Combine(outputDirectory, $"{baseName}-converted.wav");

            // Normalize even WAV inputs to predictable 44.1 kHz, 16-bit PCM WAV.
            using (var reader = new MediaFoundationReader(dialog.FileName))
            using (var resampler = new MediaFoundationResampler(reader, new WaveFormat(44100, 16, 2)))
            {
                resampler.ResamplerQuality = 60;
                WaveFileWriter.CreateWaveFile(outputPath, resampler);
            }

            _wavPath = outputPath;
            _fileBox.Text = Path.GetFileName(dialog.FileName) + " → standard WAV";
            _status.Text = $"Converted successfully: {Path.GetFileName(outputPath)}";
        }
        catch (Exception ex)
        {
            _wavPath = null;
            _fileBox.Text = "";
            _status.Text = "Audio conversion failed.";
            MessageBox.Show(this,
                "Windows couldn't decode or convert this audio file. Try a WAV, MP3, M4A, AAC, or WMA file supported by Windows.\n\nDetails: " + ex.Message,
                "Conversion failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _browseButton.Enabled = true;
        }
    }

    private void StartDetection()
    {
        if (string.IsNullOrWhiteSpace(_wavPath) || !File.Exists(_wavPath))
        {
            MessageBox.Show(this, "Choose a valid footsteps WAV file first.", "Footsteps WAV required",
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
            _output = new WaveOutEvent { DeviceNumber = device.Index, Volume = _volume.Value / 100f };
            _loop = new LoopStream(new AudioFileReader(_wavPath));
            _output.Init(_loop);
            _running = true;
            _moving = false;
            _pollTimer.Start();
            _startButton.Enabled = false;
            _stopButton.Enabled = true;
            _browseButton.Enabled = false;
            _deviceBox.Enabled = false;
            _status.Text = "Listening for movement keys… Focus the VRChat window.";
        }
        catch (Exception ex)
        {
            DisposeAudio();
            MessageBox.Show(this, $"Couldn't start audio playback.\n\n{ex.Message}", "Audio error",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void StopDetection()
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

    private void PollMovement()
    {
        if (!_running) return;

        bool vrchatFocused = IsVrChatForeground();
        bool movingNow = vrchatFocused && IsDown(Keys.W) || vrchatFocused && IsDown(Keys.A) ||
                         vrchatFocused && IsDown(Keys.S) || vrchatFocused && IsDown(Keys.D) ||
                         vrchatFocused && IsDown(Keys.Up) || vrchatFocused && IsDown(Keys.Down) ||
                         vrchatFocused && IsDown(Keys.Left) || vrchatFocused && IsDown(Keys.Right);

        bool fastNow = vrchatFocused && IsDown(Keys.ShiftKey);
        if (fastNow != _fastMode)
        {
            _fastMode = fastNow;
            if (_loop != null) _loop.Fast = _fastMode;
            if (vrchatFocused)
                _status.Text = _fastMode ? "Fast footsteps — Shift held." : (_moving ? "Moving — normal footsteps." : "Ready.");
        }

        if (movingNow != _moving)
        {
            _moving = movingNow;
            if (_moving)
            {
                try
                {
                    if (_loop != null) _loop.Position = 0;
                    _output?.Play();
                    _status.Text = "Moving — footsteps looping.";
                }
                catch (Exception ex)
                {
                    _status.Text = "Playback error: " + ex.Message;
                }
            }
            else
            {
                StopLoop();
                _status.Text = "Stopped moving — footsteps paused.";
            }
        }
        else if (!vrchatFocused && (DateTime.Now - _lastStatus).TotalSeconds > 2)
        {
            _lastStatus = DateTime.Now;
            _status.Text = "Waiting for VRChat to be the active window…";
        }
    }

    private static bool IsDown(Keys key) => (GetAsyncKeyState((int)key) & 0x8000) != 0;

    private static bool IsVrChatForeground()
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return false;
        GetWindowThreadProcessId(hwnd, out uint processId);
        try
        {
            using var process = Process.GetProcessById((int)processId);
            return process.ProcessName.Contains("VRChat", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private void StopLoop()
    {
        try { _output?.Stop(); } catch { }
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

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    private sealed record AudioDevice(int Index, string Name)
    {
        public override string ToString() => Name;
    }

    private sealed class LoopStream : WaveStream
    {
        private readonly WaveStream _source;
        public bool Fast { get; set; }
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
            if (!Fast)
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

            // Fast mode advances through the source by 1.5 frames for every output
            // frame. This speeds the footsteps up without needing another audio device.
            int blockAlign = WaveFormat.BlockAlign;
            int requestedFrames = count / blockAlign;
            int producedFrames = 0;
            byte[] frame = new byte[blockAlign];
            while (producedFrames < requestedFrames)
            {
                if (_source.Position + blockAlign > _source.Length)
                    _source.Position = 0;

                int read = _source.Read(frame, 0, blockAlign);
                if (read < blockAlign)
                {
                    _source.Position = 0;
                    read = _source.Read(frame, 0, blockAlign);
                    if (read < blockAlign) break;
                }

                Buffer.BlockCopy(frame, 0, buffer, offset + producedFrames * blockAlign, blockAlign);
                // Skip one whole source frame every other output frame to average 1.5×.
                // Keeping seeks aligned to BlockAlign avoids corrupting interleaved audio samples.
                if ((producedFrames & 1) == 0)
                    _source.Position = Math.Min(_source.Length, _source.Position + blockAlign);
                producedFrames++;
            }
            return producedFrames * blockAlign;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) _source.Dispose();
            base.Dispose(disposing);
        }
    }
}
