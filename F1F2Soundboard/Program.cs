using System.Runtime.InteropServices;
using NAudio.Wave;

namespace F1F2Soundboard;

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
    public int Number { get; }
    public string Name { get; }
    public AudioDevice(int number, string name) { Number = number; Name = name; }
    public override string ToString() => Name;
}

internal sealed class SoundSlot
{
    public string? Path { get; set; }
    public TextBox FileBox { get; } = new() { ReadOnly = true, Dock = DockStyle.Fill };
    public WaveOutEvent? Output { get; set; }
    public AudioFileReader? Reader { get; set; }
    public bool Playing => Output?.PlaybackState == PlaybackState.Playing;
}

internal sealed class MainForm : Form
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
    private const int VK_F1 = 0x70, VK_F2 = 0x71;

    [StructLayout(LayoutKind.Sequential)]
    private struct KbdLlHookStruct
    {
        public uint VkCode, ScanCode, Flags, Time;
        public IntPtr ExtraInfo;
    }

    private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);

    private readonly ComboBox outputBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
    private readonly SoundSlot slot1 = new();
    private readonly SoundSlot slot2 = new();
    private readonly Label status = new() { AutoSize = true, Text = "Ready. Press F1 or F2 to play." };
    private readonly HashSet<int> keysDown = new();
    private readonly object audioLock = new();
    private HookProc? hookCallback;
    private IntPtr hook;
    private bool closing;
    private bool loadingDevices;

    public MainForm()
    {
        Text = "F1 / F2 Soundboard";
        ClientSize = new Size(650, 250);
        MinimumSize = new Size(650, 250);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, Padding = new Padding(14),
            ColumnCount = 3, RowCount = 5
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 105));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        AddSlotRow(layout, 0, "F1 sound:", slot1, "Browse F1...", () => PickFile(slot1));
        AddSlotRow(layout, 1, "F2 sound:", slot2, "Browse F2...", () => PickFile(slot2));

        layout.Controls.Add(new Label { Text = "Audio output:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 2);
        layout.Controls.Add(outputBox, 1, 2);
        var refresh = new Button { Text = "Refresh", AutoSize = true };
        refresh.Click += (_, _) => LoadDevices();
        layout.Controls.Add(refresh, 2, 2);

        layout.Controls.Add(new Label { Text = "Hotkeys:", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 3);
        layout.Controls.Add(new Label { Text = "F1 plays slot 1     •     F2 plays slot 2", AutoSize = true, Anchor = AnchorStyles.Left }, 1, 3);
        layout.Controls.Add(status, 0, 4);
        layout.SetColumnSpan(status, 3);
        Controls.Add(layout);

        LoadDevices();
        outputBox.SelectedIndexChanged += (_, _) => { if (!loadingDevices) StopAll(); };

        hookCallback = KeyboardHook;
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, hookCallback, IntPtr.Zero, 0);
        if (hook == IntPtr.Zero)
            status.Text = "Could not register global hotkeys. Try restarting the app.";

        FormClosing += (_, _) => Cleanup();
    }

    private static void AddSlotRow(TableLayoutPanel layout, int row, string label, SoundSlot slot, string buttonText, Action browse)
    {
        layout.Controls.Add(new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left }, 0, row);
        layout.Controls.Add(slot.FileBox, 1, row);
        var button = new Button { Text = buttonText, AutoSize = true };
        button.Click += (_, _) => browse();
        layout.Controls.Add(button, 2, row);
    }

    private void PickFile(SoundSlot slot)
    {
        using var dialog = new OpenFileDialog
        {
            Title = "Choose a sound",
            Filter = "Audio files|*.wav;*.mp3;*.flac;*.wma;*.aac;*.m4a;*.mp4;*.aif;*.aiff;*.ogg;*.opus|All files (*.*)|*.*"
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        StopSlot(slot);
        try
        {
            using var test = new AudioFileReader(dialog.FileName);
            slot.Path = dialog.FileName;
            slot.FileBox.Text = Path.GetFileName(dialog.FileName);
            status.Text = $"Loaded {Path.GetFileName(dialog.FileName)}";
        }
        catch (Exception ex)
        {
            slot.Path = null;
            slot.FileBox.Clear();
            status.Text = "Could not load audio: " + ex.Message;
        }
    }

    private void LoadDevices()
    {
        loadingDevices = true;
        int previous = (outputBox.SelectedItem as AudioDevice)?.Number ?? -1;
        outputBox.Items.Clear();
        outputBox.Items.Add(new AudioDevice(-1, "Windows default output"));
        try
        {
            for (int i = 0; i < WaveOut.DeviceCount; i++)
                outputBox.Items.Add(new AudioDevice(i, WaveOut.GetCapabilities(i).ProductName));
        }
        catch (Exception ex) { status.Text = "Device list error: " + ex.Message; }

        int selected = 0;
        for (int i = 0; i < outputBox.Items.Count; i++)
            if (outputBox.Items[i] is AudioDevice d && d.Number == previous) selected = i;
        outputBox.SelectedIndex = selected;
        loadingDevices = false;
    }

    private IntPtr KeyboardHook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            int message = wParam.ToInt32();
            if (message is WM_KEYDOWN or WM_SYSKEYDOWN or WM_KEYUP or WM_SYSKEYUP)
            {
                int key = (int)Marshal.PtrToStructure<KbdLlHookStruct>(lParam).VkCode;
                if (key is VK_F1 or VK_F2)
                {
                    bool down = message is WM_KEYDOWN or WM_SYSKEYDOWN;
                    try
                    {
                        if (!IsDisposed && IsHandleCreated)
                            BeginInvoke(new Action(() => HandleHotkey(key, down)));
                    }
                    catch (InvalidOperationException) { }
                }
            }
        }
        return CallNextHookEx(hook, code, wParam, lParam);
    }

    private void HandleHotkey(int key, bool down)
    {
        if (closing) return;
        if (!down) { keysDown.Remove(key); return; }
        if (!keysDown.Add(key)) return; // Ignore keyboard auto-repeat.
        Play(key == VK_F1 ? slot1 : slot2, key == VK_F1 ? "F1" : "F2");
    }

    private void Play(SoundSlot slot, string keyName)
    {
        if (string.IsNullOrWhiteSpace(slot.Path))
        {
            status.Text = $"Assign a sound to {keyName} first.";
            return;
        }
        if (outputBox.SelectedItem is not AudioDevice device) return;

        lock (audioLock)
        {
            StopSlotCore(slot);
            try
            {
                var reader = new AudioFileReader(slot.Path);
                var player = new WaveOutEvent { DeviceNumber = device.Number, DesiredLatency = 100 };
                slot.Reader = reader;
                slot.Output = player;
                player.PlaybackStopped += (_, _) =>
                {
                    try
                    {
                        if (!IsDisposed && IsHandleCreated)
                            BeginInvoke(new Action(() => DisposeSlotPlayback(slot, player, reader)));
                        else { player.Dispose(); reader.Dispose(); }
                    }
                    catch (InvalidOperationException) { player.Dispose(); reader.Dispose(); }
                };
                player.Init(reader);
                player.Play();
                status.Text = $"{keyName} playing: {Path.GetFileName(slot.Path)} → {device.Name}";
            }
            catch (Exception ex)
            {
                StopSlotCore(slot);
                status.Text = "Playback error: " + ex.Message;
            }
        }
    }

    private void DisposeSlotPlayback(SoundSlot slot, WaveOutEvent player, AudioFileReader reader)
    {
        lock (audioLock)
        {
            if (ReferenceEquals(slot.Output, player))
            {
                slot.Output = null;
                slot.Reader = null;
            }
            player.Dispose();
            reader.Dispose();
        }
    }

    private void StopSlot(SoundSlot slot)
    {
        lock (audioLock) StopSlotCore(slot);
    }

    private static void StopSlotCore(SoundSlot slot)
    {
        var player = slot.Output;
        var reader = slot.Reader;
        slot.Output = null;
        slot.Reader = null;
        if (player != null) { try { player.Stop(); } catch { } player.Dispose(); }
        reader?.Dispose();
    }

    private void StopAll()
    {
        StopSlot(slot1);
        StopSlot(slot2);
    }

    private void Cleanup()
    {
        closing = true;
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
        StopAll();
    }
}