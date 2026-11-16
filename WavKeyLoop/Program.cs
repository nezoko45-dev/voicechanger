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

internal sealed class MainForm : Form
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
    private const int VK_A = 0x41, VK_S = 0x53, VK_D = 0x44, VK_W = 0x57;

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
    private readonly Label status = new() { AutoSize = true, Text = "Choose a WAV file, then hold W, A, S, or D." };
    private readonly HashSet<int> held = new();
    private readonly object audioLock = new();

    private string? wavPath;
    private AudioFileReader? reader;
    private WaveOutEvent? output;
    private IntPtr hook;
    private HookProc? hookProc;
    private bool closing;

    public MainForm()
    {
        Text = "WAV Key Loop";
        Width = 590;
        Height = 255;
        MinimumSize = new Size(590, 255);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, Padding = new Padding(14),
            ColumnCount = 2, RowCount = 5
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 110));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        layout.Controls.Add(new Label { Text = "WAV file:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 0);
        var filePanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        filePanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        filePanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        filePanel.Controls.Add(wavBox, 0, 0);
        var browse = new Button { Text = "Browse...", AutoSize = true };
        browse.Click += (_, _) => PickWav();
        filePanel.Controls.Add(browse, 1, 0);
        layout.Controls.Add(filePanel, 1, 0);

        layout.Controls.Add(new Label { Text = "Output device:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 1);
        layout.Controls.Add(outputBox, 1, 1);
        layout.Controls.Add(new Label { Text = "Hotkeys:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 2);
        layout.Controls.Add(new Label { Text = "Hold W / A / S / D to loop; release all to stop.", AutoSize = true, Anchor = AnchorStyles.Left }, 1, 2);
        layout.Controls.Add(status, 0, 3);
        layout.SetColumnSpan(status, 2);

        var refresh = new Button { Text = "Refresh audio devices", AutoSize = true };
        refresh.Click += (_, _) => LoadDevices();
        layout.Controls.Add(refresh, 1, 4);
        Controls.Add(layout);

        LoadDevices();
        outputBox.SelectedIndexChanged += (_, _) =>
        {
            if (held.Count == 0) ResetAudioEngine();
        };

        hookProc = HookCallback;
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, IntPtr.Zero, 0);
        if (hook == IntPtr.Zero)
            status.Text = "Global keyboard hook failed. Try launching the app again.";

        FormClosing += (_, _) => Cleanup();
    }

    private void PickWav()
    {
        using var dialog = new OpenFileDialog
        {
            Filter = "WAV audio (*.wav)|*.wav",
            Title = "Select WAV file"
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;

        StopAudio();
        ResetAudioEngine();
        wavPath = dialog.FileName;
        wavBox.Text = Path.GetFileName(wavPath);
        status.Text = "Ready — hold W, A, S, or D to play.";
    }

    private void LoadDevices()
    {
        int previous = outputBox.SelectedIndex;
        outputBox.Items.Clear();

        for (int i = 0; i < WaveOut.DeviceCount; i++)
        {
            var caps = WaveOut.GetCapabilities(i);
            outputBox.Items.Add($"{caps.ProductName} (device {i})");
        }

        if (outputBox.Items.Count > 0)
            outputBox.SelectedIndex = Math.Clamp(previous, 0, outputBox.Items.Count - 1);
        else
            status.Text = "No WaveOut output devices found.";
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
                if (key is VK_W or VK_A or VK_S or VK_D)
                {
                    bool down = msg is WM_KEYDOWN or WM_SYSKEYDOWN;
                    try
                    {
                        if (!IsDisposed && IsHandleCreated)
                            BeginInvoke(new Action(() => SetKeyState(key, down)));
                    }
                    catch (InvalidOperationException) { }
                }
            }
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    private void SetKeyState(int key, bool down)
    {
        if (closing) return;
        if (down) held.Add(key);
        else held.Remove(key);

        if (held.Count > 0) StartAudio();
        else StopAudio();
    }

    private void StartAudio()
    {
        if (string.IsNullOrWhiteSpace(wavPath) || outputBox.SelectedIndex < 0) return;

        lock (audioLock)
        {
            if (output?.PlaybackState == PlaybackState.Playing) return;

            try
            {
                reader ??= new AudioFileReader(wavPath);
                if (output == null)
                {
                    output = new WaveOutEvent
                    {
                        DeviceNumber = outputBox.SelectedIndex,
                        DesiredLatency = 100
                    };
                    output.PlaybackStopped += (_, e) =>
                    {
                        lock (audioLock)
                        {
                            if (closing || held.Count == 0 || reader == null || output == null) return;
                            if (e.Exception != null)
                            {
                                UpdateStatus("Playback stopped: " + e.Exception.Message);
                                return;
                            }

                            try
                            {
                                reader.Position = 0;
                                output.Play();
                            }
                            catch (Exception ex)
                            {
                                UpdateStatus("Playback error: " + ex.Message);
                            }
                        }
                    };
                    output.Init(reader);
                }

                reader.Position = 0;
                output.Play();
                UpdateStatus("PLAYING — release all WASD keys to stop.");
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
                if (reader != null) reader.Position = 0;
            }
            catch { }
        }

        UpdateStatus(wavPath == null
            ? "Choose a WAV file first."
            : "Ready — hold W, A, S, or D to play.");
    }

    private void ResetAudioEngine()
    {
        lock (audioLock)
        {
            try { output?.Stop(); } catch { }
            output?.Dispose();
            reader?.Dispose();
            output = null;
            reader = null;
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
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
        lock (audioLock)
        {
            try { output?.Stop(); } catch { }
            output?.Dispose();
            reader?.Dispose();
            output = null;
            reader = null;
        }
    }
}