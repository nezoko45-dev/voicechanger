using System.Runtime.InteropServices;
using NAudio.Wave;

namespace WavKeyLoop;

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

internal sealed class SpeedLoopingSampleProvider : ISampleProvider
{
 private readonly float[] samples; private readonly int channels,totalFrames; private double position; private float playbackRate=1f;
 public SpeedLoopingSampleProvider(float[] samples,WaveFormat format){if(samples.Length==0||samples.Length%format.Channels!=0)throw new ArgumentException("No playable audio samples.");this.samples=samples;WaveFormat=format;channels=format.Channels;totalFrames=samples.Length/channels;}
 public void Reset() => position = 0;
    public WaveFormat WaveFormat{get;} public float PlaybackRate{get=>Volatile.Read(ref playbackRate);set=>Volatile.Write(ref playbackRate,Math.Clamp(value,.25f,4f));}
 public int Read(float[] buffer,int offset,int count){int frames=count/channels;float rate=PlaybackRate;for(int frame=0;frame<frames;frame++){int af=(int)position,bf=(af+1)%totalFrames;float blend=(float)(position-af);int a=af*channels,b=bf*channels,o=offset+frame*channels;for(int ch=0;ch<channels;ch++)buffer[o+ch]=samples[a+ch]+(samples[b+ch]-samples[a+ch])*blend;position+=rate;if(position>=totalFrames)position%=totalFrames;}return frames*channels;}
}

internal sealed class MainForm : Form
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
    private const int VK_A = 0x41, VK_S = 0x53, VK_D = 0x44, VK_W = 0x57;
    private const int VK_SHIFT = 0x10, VK_LSHIFT = 0xA0, VK_RSHIFT = 0xA1;

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

    private readonly ComboBox outputBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
    private readonly TextBox wavBox = new() { ReadOnly = true, Dock = DockStyle.Fill };
    private readonly Label status = new() { AutoSize = true, Text = "Choose an audio file, then hold W, A, S, or D." };
    private readonly TrackBar speedSlider = new() { Minimum = 50, Maximum = 200, Value = 100, TickFrequency = 25, SmallChange = 5, LargeChange = 25, Dock = DockStyle.Fill };
    private readonly Label speedValue = new() { AutoSize = true, Text = "1.00x", Anchor = AnchorStyles.Left };
    private readonly HashSet<int> held = new();
    private readonly object audioLock = new();
    private readonly System.Windows.Forms.Timer testTimer = new() { Interval = 2000 };

    private string? audioPath;
    private SpeedLoopingSampleProvider? speedProvider;
    private bool shiftHeld;
    private WaveOutEvent? output;
    private IntPtr hook;
    private HookProc? hookProc;
    private bool closing;
    private bool testActive;

    public MainForm()
    {
        Text = "Audio Key Loop";
        Width = 680;
        Height = 345;
        MinimumSize = new Size(680, 345);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, Padding = new Padding(14),
            ColumnCount = 2, RowCount = 7
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 115));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        layout.Controls.Add(new Label { Text = "Audio file:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 0);
        var filePanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        filePanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        filePanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        filePanel.Controls.Add(wavBox, 0, 0);
        var browse = new Button { Text = "Browse...", AutoSize = true };
        browse.Click += (_, _) => PickAudio();
        filePanel.Controls.Add(browse, 1, 0);
        layout.Controls.Add(filePanel, 1, 0);

        layout.Controls.Add(new Label { Text = "Output device:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 1);
        layout.Controls.Add(outputBox, 1, 1);
        layout.Controls.Add(new Label { Text = "Hotkeys:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 2);
        layout.Controls.Add(new Label { Text = "Hold W / A / S / D to loop; hold Shift for fast mode.", AutoSize = true, Anchor = AnchorStyles.Left }, 1, 2);
        layout.Controls.Add(new Label { Text = "Playback speed:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 3);
        var speedPanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        speedPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); speedPanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        speedPanel.Controls.Add(speedSlider, 0, 0); speedPanel.Controls.Add(speedValue, 1, 0);
        layout.Controls.Add(speedPanel, 1, 3); speedSlider.ValueChanged += (_, _) => UpdatePlaybackSpeed();
        layout.Controls.Add(status, 0, 4); layout.SetColumnSpan(status, 2);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true };
        var test = new Button { Text = "Test audio (2 sec)", AutoSize = true };
        test.Click += (_, _) => TestAudio();
        var refresh = new Button { Text = "Refresh audio devices", AutoSize = true };
        refresh.Click += (_, _) => LoadDevices();
        buttons.Controls.Add(test);
        buttons.Controls.Add(refresh);
        layout.Controls.Add(buttons, 1, 5);
        Controls.Add(layout);

        LoadDevices();
        outputBox.SelectedIndexChanged += (_, _) =>
        {
            if (held.Count == 0 && !testActive) ResetAudioEngine();
        };

        testTimer.Tick += (_, _) =>
        {
            testTimer.Stop();
            testActive = false;
            if (held.Count == 0) StopAudio();
        };

        hookProc = HookCallback;
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, IntPtr.Zero, 0);
        if (hook == IntPtr.Zero)
            status.Text = "Global keyboard hook failed. Try launching the app again.";

        FormClosing += (_, _) => Cleanup();
    }

    private void PickAudio()
    {
        using var dialog = new OpenFileDialog
        {
            Filter = "Supported audio files|*.wav;*.mp3;*.flac;*.wma;*.aac;*.m4a;*.mp4;*.aif;*.aiff;*.ogg;*.opus;*.webm;*.mka|All files (*.*)|*.*",
            Title = "Select audio file"
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;

        testTimer.Stop();
        testActive = false;
        StopAudio();
        ResetAudioEngine();
        audioPath = dialog.FileName;
        wavBox.Text = Path.GetFileName(audioPath);

        try
        {
            using var check = new AudioFileReader(audioPath);
            status.Text = $"Loaded: {check.WaveFormat.SampleRate} Hz, {check.WaveFormat.Channels} channel(s), {check.TotalTime.TotalSeconds:F1}s";
        }
        catch (Exception ex)
        {
            audioPath = null;
            wavBox.Text = "";
            status.Text = "Could not open audio file (format/codec may be unavailable): " + ex.Message;
        }
    }

    private void LoadDevices()
    {
        int previous = outputBox.SelectedItem is AudioDevice selected ? selected.DeviceNumber : -1;
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
            UpdateStatus("Could not enumerate audio devices: " + ex.Message);
        }

        int found = -1;
        for (int i = 0; i < outputBox.Items.Count; i++)
            if (outputBox.Items[i] is AudioDevice d && d.DeviceNumber == previous) found = i;
        outputBox.SelectedIndex = found >= 0 ? found : 0;
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int msg = wParam.ToInt32();
            if (msg is WM_KEYDOWN or WM_SYSKEYDOWN or WM_KEYUP or WM_SYSKEYUP)
            {
                var data = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
                int key = (int)data.vkCode;
                if (key is VK_W or VK_A or VK_S or VK_D or VK_SHIFT or VK_LSHIFT or VK_RSHIFT)
                {
                    bool down = msg is WM_KEYDOWN or WM_SYSKEYDOWN;
                    try { if (!IsDisposed && IsHandleCreated) BeginInvoke(new Action(() => { if (key is VK_SHIFT or VK_LSHIFT or VK_RSHIFT) SetShiftState(down); else SetKeyState(key, down); })); }
                    catch (InvalidOperationException) { }
                }
            }
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    private void SetShiftState(bool down){if(closing||shiftHeld==down)return;shiftHeld=down;UpdatePlaybackSpeed();}
    private float CurrentPlaybackSpeed()=>speedSlider.Value/100f*(shiftHeld?2f:1f);
    private void UpdatePlaybackSpeed(){float speed=CurrentPlaybackSpeed();speedValue.Text=$"{speed:F2}x"+(shiftHeld?" (Shift)":"");if(speedProvider!=null)speedProvider.PlaybackRate=speed;}
    private void SetKeyState(int key, bool down)
    {
        if (closing) return;
        if (down) held.Add(key);
        else held.Remove(key);

        if (held.Count > 0) StartAudio();
        else if (!testActive) StopAudio();
    }

    private void TestAudio()
    {
        if (audioPath == null)
        {
            status.Text = "Choose an audio file first.";
            return;
        }
        testTimer.Stop();
        testActive = true;
        StartAudio();
        if (output?.PlaybackState == PlaybackState.Playing) testTimer.Start();
    }

    private void StartAudio()
    {
        if (string.IsNullOrWhiteSpace(audioPath) || outputBox.SelectedItem is not AudioDevice device) return;

        lock (audioLock)
        {
            if (output?.PlaybackState == PlaybackState.Playing) return;

            try
            {
                if (speedProvider == null)
                {
                    using var decodeReader = new AudioFileReader(audioPath);
                    var decoded = new List<float>(); var chunk = new float[16384]; int n;
                    while ((n = decodeReader.Read(chunk, 0, chunk.Length)) > 0) decoded.AddRange(chunk.AsSpan(0, n).ToArray());
                    speedProvider = new SpeedLoopingSampleProvider(decoded.ToArray(), decodeReader.WaveFormat);
                }

                if (output == null)
                {
                    output = new WaveOutEvent
                    {
                        DeviceNumber = device.DeviceNumber,
                        DesiredLatency = 150
                    };
                    output.Init(speedProvider);
                }

                speedProvider.PlaybackRate = CurrentPlaybackSpeed();
                output.Play();
                UpdateStatus($"PLAYING through {device.Name} — release all WASD keys to stop.");
            }
            catch (Exception ex)
            {
                UpdateStatus("Audio error: " + ex.Message);
            }
        }
    }

    private void StopAudio()
    {
        lock (audioLock)
        {
            try
            {
                output?.Stop();
            speedProvider?.Reset();
            }
            catch (Exception ex)
            {
                UpdateStatus("Stop error: " + ex.Message);
            }
        }

        if (!closing)
            UpdateStatus(audioPath == null ? "Choose an audio file first." : "Ready — hold W, A, S, or D to play.");
    }

    private void ResetAudioEngine()
    {
        lock (audioLock)
        {
            try { output?.Stop(); } catch { }
            output?.Dispose();
            speedProvider = null;
            output = null;

        }
    }

    private void UpdateStatus(string message)
    {
        if (closing || IsDisposed) return;
        if (IsHandleCreated && InvokeRequired)
        {
            try { BeginInvoke(new Action(() => { if (!closing && !IsDisposed) status.Text = message; })); }
            catch (InvalidOperationException) { }
        }
        else status.Text = message;
    }

    private void Cleanup()
    {
        closing = true;
        testTimer.Stop();
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
        lock (audioLock)
        {
            try { output?.Stop(); } catch { }
            output?.Dispose();

            output = null;

        }
        testTimer.Dispose();
    }
}