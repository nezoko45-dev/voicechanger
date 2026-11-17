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
    private readonly Label status = new() { AutoSize = true, Text = "Choose a WAV or MP3 file, then hold F to loop it." };
    private readonly Button browseButton = new() { Text = "Browse...", AutoSize = true };
    private readonly Button testButton = new() { Text = "Test audio", AutoSize = true };

    private string? audioPath;
    private LoopingAudioProvider? provider;
    private WaveOutEvent? output;
    private IntPtr hook;
    private HookProc? hookProc;
    private bool fHeld;
    private bool closing;

    public MainForm()
    {
        Text = "F Key Sound Loop";
        Width = 560;
        Height = 190;
        MinimumSize = new Size(560, 190);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(14),
            ColumnCount = 2,
            RowCount = 4
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 95));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        layout.Controls.Add(new Label { Text = "Sound file:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 0);
        var filePanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        filePanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        filePanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        filePanel.Controls.Add(fileBox, 0, 0);
        filePanel.Controls.Add(browseButton, 1, 0);
        layout.Controls.Add(filePanel, 1, 0);

        layout.Controls.Add(new Label { Text = "Hotkey:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 1);
        layout.Controls.Add(new Label { Text = "Hold F to play the sound repeatedly; release F to stop.", AutoSize = true, Anchor = AnchorStyles.Left }, 1, 1);
        layout.Controls.Add(status, 0, 2);
        layout.SetColumnSpan(status, 2);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true };
        buttons.Controls.Add(testButton);
        layout.Controls.Add(buttons, 1, 3);
        Controls.Add(layout);

        browseButton.Click += (_, _) => PickAudio();
        testButton.Click += (_, _) => TestAudio();

        hookProc = HookCallback;
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, IntPtr.Zero, 0);
        if (hook == IntPtr.Zero)
            status.Text = "Could not install the global F-key hook. Restart the app and try again.";

        FormClosing += (_, _) => Cleanup();
    }

    private void PickAudio()
    {
        using var dialog = new OpenFileDialog
        {
            Filter = "Audio files (*.wav;*.mp3)|*.wav;*.mp3|WAV files (*.wav)|*.wav|MP3 files (*.mp3)|*.mp3|All files (*.*)|*.*",
            Title = "Choose a sound to loop"
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;

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
        else StopPlayback();
    }

    private void StartPlayback()
    {
        if (string.IsNullOrWhiteSpace(audioPath)) return;
        try
        {
            if (provider == null)
            {
                provider = new LoopingAudioProvider(audioPath);
                output = new WaveOutEvent { DesiredLatency = 100 };
                output.Init(provider);
            }
            if (output?.PlaybackState != PlaybackState.Playing)
            {
                provider.Reset();
                output?.Play();
            }
            status.Text = "PLAYING — keep holding F. Release F to stop.";
        }
        catch (Exception ex)
        {
            status.Text = "Playback error: " + ex.Message;
            StopPlayback();
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
        StartPlayback();
        if (output?.PlaybackState == PlaybackState.Playing)
        {
            var timer = new System.Windows.Forms.Timer { Interval = 1500 };
            timer.Tick += (_, _) =>
            {
                timer.Stop();
                timer.Dispose();
                if (!fHeld) StopPlayback();
            };
            timer.Start();
        }
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
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
        DisposeAudio();
    }
}
