using System.Runtime.InteropServices;
using NAudio.Wave;

namespace FKeySoundLoop;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

internal sealed class AudioDevice
{
    public int DeviceNumber { get; }
    public string Name { get; }
    public AudioDevice(int deviceNumber, string name) { DeviceNumber = deviceNumber; Name = name; }
    public override string ToString() => Name;
}

internal sealed class LoopingAudioProvider : ISampleProvider, IDisposable
{
    private readonly AudioFileReader reader;
    public WaveFormat WaveFormat => reader.WaveFormat;

    public LoopingAudioProvider(string path) => reader = new AudioFileReader(path);

    public int Read(float[] buffer, int offset, int count)
    {
        int written = 0;
        while (written < count)
        {
            int read = reader.Read(buffer, offset + written, count - written);
            if (read == 0)
            {
                reader.Position = 0;
                read = reader.Read(buffer, offset + written, count - written);
                if (read == 0) break;
            }
            written += read;
        }
        return written;
    }

    public void Reset() => reader.Position = 0;
    public void Dispose() => reader.Dispose();
}

internal sealed class MainForm : Form
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_F = 0x46;

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode, scanCode, flags, time;
        public IntPtr dwExtraInfo;
    }

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr hMod, uint threadId);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int nCode, IntPtr wParam, IntPtr lParam);

    private readonly TextBox fileBox = new() { ReadOnly = true, Dock = DockStyle.Fill };
    private readonly ComboBox outputBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
    private readonly Label status = new() { AutoSize = true, Text = "Choose a WAV or MP3 file, then hold F to loop it." };
    private readonly Button browseButton = new() { Text = "Browse...", AutoSize = true };
    private readonly Button testButton = new() { Text = "Test audio (2 sec)", AutoSize = true };
    private readonly Button refreshButton = new() { Text = "Refresh devices", AutoSize = true };
    private readonly System.Windows.Forms.Timer testTimer = new() { Interval = 2000 };

    private string? audioPath;
    private LoopingAudioProvider? provider;
    private WaveOutEvent? output;
    private IntPtr hook;
    private HookProc? hookProc;
    private bool fHeld;
    private bool closing;
    private bool testActive;
    private bool loadingDevices;

    public MainForm()
    {
        Text = "F Key Sound Loop";
        Width = 650;
        Height = 245;
        MinimumSize = new Size(650, 245);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(14),
            ColumnCount = 2,
            RowCount = 6
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 110));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        layout.Controls.Add(new Label { Text = "Sound file:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 0);
        var filePanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        filePanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        filePanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        filePanel.Controls.Add(fileBox, 0, 0);
        filePanel.Controls.Add(browseButton, 1, 0);
        layout.Controls.Add(filePanel, 1, 0);

        layout.Controls.Add(new Label { Text = "Output device:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 1);
        var devicePanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        devicePanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        devicePanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        devicePanel.Controls.Add(outputBox, 0, 0);
        devicePanel.Controls.Add(refreshButton, 1, 0);
        layout.Controls.Add(devicePanel, 1, 1);

        layout.Controls.Add(new Label { Text = "Hotkey:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 2);
        layout.Controls.Add(new Label { Text = "Hold F to loop the sound; release F to stop.", AutoSize = true, Anchor = AnchorStyles.Left }, 1, 2);
        layout.Controls.Add(status, 0, 3);
        layout.SetColumnSpan(status, 2);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true };
        buttons.Controls.Add(testButton);
        layout.Controls.Add(buttons, 1, 4);
        Controls.Add(layout);

        browseButton.Click += (_, _) => PickAudio();
        testButton.Click += (_, _) => TestAudio();
        refreshButton.Click += (_, _) => LoadDevices();
        outputBox.SelectedIndexChanged += (_, _) => ChangeOutputDevice();

        testTimer.Tick += (_, _) =>
        {
            testTimer.Stop();
            testActive = false;
            if (!fHeld) StopPlayback();
        };

        LoadDevices();

        hookProc = HookCallback;
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, IntPtr.Zero, 0);
        if (hook == IntPtr.Zero)
            status.Text = "Could not install the global F-key hook. Restart the app and try again.";

        FormClosing += (_, _) => Cleanup();
    }

    private void LoadDevices()
    {
        int previous = outputBox.SelectedItem is AudioDevice selected ? selected.DeviceNumber : -1;
        loadingDevices = true;
        outputBox.Items.Clear();
        outputBox.Items.Add(new AudioDevice(-1, "Windows default output"));

        try
        {
            for (int i = 0; i < WaveOut.DeviceCount; i++)
            {
                var caps = WaveOut.GetCapabilities(i);
                outputBox.Items.Add(new AudioDevice(i, caps.ProductName));
            }
        }
        catch (Exception ex)
        {
            status.Text = "Could not enumerate audio devices: " + ex.Message;
        }

        int selectedIndex = 0;
        for (int i = 0; i < outputBox.Items.Count; i++)
            if (outputBox.Items[i] is AudioDevice d && d.DeviceNumber == previous) selectedIndex = i;
        outputBox.SelectedIndex = selectedIndex;
        loadingDevices = false;
    }

    private void ChangeOutputDevice()
    {
        if (loadingDevices || closing) return;
        DisposeAudio();
        if (fHeld) StartPlayback();
        else status.Text = audioPath == null ? "Choose a WAV or MP3 file, then hold F." : "Output device changed. Hold F to play.";
    }

    private void PickAudio()
    {
        using var dialog = new OpenFileDialog
        {
            Filter = "Audio files (*.wav;*.mp3)|*.wav;*.mp3|WAV files (*.wav)|*.wav|MP3 files (*.mp3)|*.mp3|All files (*.*)|*.*",
            Title = "Choose a sound to loop"
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;

        testTimer.Stop();
        testActive = false;
        StopPlayback();
        DisposeAudio();
        try
        {
            using var check = new AudioFileReader(dialog.FileName);
            audioPath = dialog.FileName;
            fileBox.Text = Path.GetFileName(audioPath);
            status.Text = $"Loaded {check.WaveFormat.SampleRate} Hz audio ({check.TotalTime.TotalSeconds:F1} seconds). Hold F to loop.";
        }
        catch (Exception ex)
        {
            audioPath = null;
            fileBox.Clear();
            status.Text = "Could not open this WAV/MP3 file: " + ex.Message;
        }
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int message = wParam.ToInt32();
            if (message is WM_KEYDOWN or WM_KEYUP or WM_SYSKEYDOWN or WM_SYSKEYUP)
            {
                var key = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
                if (key.vkCode == VK_F)
                {
                    bool down = message is WM_KEYDOWN or WM_SYSKEYDOWN;
                    try
                    {
                        if (!IsDisposed && IsHandleCreated)
                            BeginInvoke(new Action(() => SetFState(down)));
                    }
                    catch (InvalidOperationException) { }
                }
            }
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    private void SetFState(bool down)
    {
        if (closing || fHeld == down) return;
        fHeld = down;
        if (down) StartPlayback();
        else
        {
            testTimer.Stop();
            testActive = false;
            StopPlayback();
        }
    }

    private void StartPlayback()
    {
        if (string.IsNullOrWhiteSpace(audioPath) || outputBox.SelectedItem is not AudioDevice device) return;
        try
        {
            if (provider == null)
            {
                provider = new LoopingAudioProvider(audioPath);
                output = new WaveOutEvent { DeviceNumber = device.DeviceNumber, DesiredLatency = 100 };
                output.Init(provider);
            }
            if (output?.PlaybackState != PlaybackState.Playing)
            {
                provider.Reset();
                output?.Play();
            }
            status.Text = $"PLAYING through {device.Name} — keep holding F.";
        }
        catch (Exception ex)
        {
            status.Text = "Playback error: " + ex.Message;
            DisposeAudio();
        }
    }

    private void StopPlayback()
    {
        try
        {
            output?.Stop();
            provider?.Reset();
        }
        catch (Exception ex)
        {
            if (!closing) status.Text = "Stop error: " + ex.Message;
        }
        if (!closing && audioPath != null)
            status.Text = "Ready — hold F to loop the sound.";
    }

    private void TestAudio()
    {
        if (string.IsNullOrWhiteSpace(audioPath))
        {
            status.Text = "Choose a WAV or MP3 file first.";
            return;
        }
        testTimer.Stop();
        testActive = true;
        StartPlayback();
        if (output?.PlaybackState == PlaybackState.Playing) testTimer.Start();
        else testActive = false;
    }

    private void DisposeAudio()
    {
        try { output?.Stop(); } catch { }
        output?.Dispose();
        provider?.Dispose();
        output = null;
        provider = null;
    }

    private void Cleanup()
    {
        closing = true;
        testTimer.Stop();
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
        DisposeAudio();
        testTimer.Dispose();
    }
}
