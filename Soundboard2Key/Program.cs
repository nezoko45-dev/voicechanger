using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Soundboard2Key;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new SoundboardForm());
    }
}

internal sealed class SoundboardForm : Form
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    private const int WM_HOTKEY = 0x0312;
    private const int HOTKEY_F1 = 1, HOTKEY_F2 = 2;

    private readonly ComboBox outputBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 390 };
    private readonly Label status = new() { AutoSize = true, Text = "Choose two MP3 files, then press F1 or F2." };
    private readonly string?[] paths = new string?[2];
    private readonly Label[] fileLabels = new Label[2];
    private readonly List<Playback> active = new();
    private MMDevice? selectedDevice;
    private MMDeviceEnumerator? enumerator;

    public SoundboardForm()
    {
        Text = "F1 / F2 Soundboard";
        Width = 560; Height = 270;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(14), ColumnCount = 2, RowCount = 5 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 110));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Controls.Add(layout);

        layout.Controls.Add(new Label { Text = "Audio output", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 0);
        var outputPanel = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = false };
        outputPanel.Controls.Add(outputBox);
        var refresh = new Button { Text = "Refresh", AutoSize = true };
        refresh.Click += (_, _) => LoadDevices();
        outputPanel.Controls.Add(refresh);
        layout.Controls.Add(outputPanel, 1, 0);

        for (int i = 0; i < 2; i++)
        {
            int slot = i;
            layout.Controls.Add(new Label { Text = $"F{i + 1} sound", AutoSize = true, Anchor = AnchorStyles.Left }, 0, i + 1);
            var panel = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = false };
            var browse = new Button { Text = "Choose MP3…", AutoSize = true };
            fileLabels[i] = new Label { Text = "No file selected", AutoSize = true, MaximumSize = new Size(320, 0), Anchor = AnchorStyles.Left };
            browse.Click += (_, _) => ChooseFile(slot);
            panel.Controls.Add(browse); panel.Controls.Add(fileLabels[i]);
            layout.Controls.Add(panel, 1, i + 1);
        }

        layout.Controls.Add(new Label { Text = "Hotkeys", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 3);
        layout.Controls.Add(new Label { Text = "F1 = Sound 1     •     F2 = Sound 2 (works in background)", AutoSize = true, Anchor = AnchorStyles.Left }, 1, 3);
        layout.Controls.Add(status, 0, 4); layout.SetColumnSpan(status, 2);
        LoadDevices();
    }

    private void LoadDevices()
    {
        try
        {
            var previous = outputBox.SelectedItem as DeviceItem;
            enumerator?.Dispose();
            enumerator = new MMDeviceEnumerator();
            outputBox.Items.Clear();
            foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
                outputBox.Items.Add(new DeviceItem(device.ID, device.FriendlyName));
            if (outputBox.Items.Count == 0) { status.Text = "No active playback devices found."; return; }
            int index = previous == null ? -1 : Enumerable.Range(0, outputBox.Items.Count)
                .FirstOrDefault(i => ((DeviceItem)outputBox.Items[i]!).Id == previous.Id, -1);
            outputBox.SelectedIndex = index >= 0 ? index : 0;
            status.Text = "Ready. Hotkeys work even when this window is minimized.";
        }
        catch (Exception ex) { status.Text = "Audio device error: " + ex.Message; }
    }

    private void ChooseFile(int slot)
    {
        using var dialog = new OpenFileDialog { Title = $"Choose sound for F{slot + 1}", Filter = "MP3 audio (*.mp3)|*.mp3|Audio files (*.mp3;*.wav;*.flac)|*.mp3;*.wav;*.flac|All files (*.*)|*.*" };
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            paths[slot] = dialog.FileName;
            fileLabels[slot].Text = Path.GetFileName(dialog.FileName);
            status.Text = $"F{slot + 1} loaded: {Path.GetFileName(dialog.FileName)}";
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        bool a = RegisterHotKey(Handle, HOTKEY_F1, 0, (uint)Keys.F1);
        bool b = RegisterHotKey(Handle, HOTKEY_F2, 0, (uint)Keys.F2);
        if (!a || !b) status.Text = "Warning: a hotkey is already registered by another app.";
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY)
        {
            if (m.WParam.ToInt32() == HOTKEY_F1) Play(0);
            if (m.WParam.ToInt32() == HOTKEY_F2) Play(1);
        }
        base.WndProc(ref m);
    }

    private void Play(int slot)
    {
        string? path = paths[slot];
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            status.Text = $"Choose an audio file for F{slot + 1} first.";
            return;
        }
        if (outputBox.SelectedItem is not DeviceItem item)
        {
            status.Text = "Select an audio output device first.";
            return;
        }
        try
        {
            var device = enumerator!.GetDevice(item.Id);
            var reader = new AudioFileReader(path);
            var output = new WasapiOut(device, AudioClientShareMode.Shared, true, 100);
            var playback = new Playback(reader, output);
            output.PlaybackStopped += (_, _) => { lock (active) active.Remove(playback); playback.Dispose(); };
            lock (active) active.Add(playback);
            output.Init(reader);
            output.Play();
            status.Text = $"Playing F{slot + 1}: {Path.GetFileName(path)} → {item.Name}";
        }
        catch (Exception ex) { status.Text = "Playback error: " + ex.Message; }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        UnregisterHotKey(Handle, HOTKEY_F1);
        UnregisterHotKey(Handle, HOTKEY_F2);
        lock (active) { foreach (var p in active.ToArray()) p.Dispose(); active.Clear(); }
        selectedDevice?.Dispose();
        enumerator?.Dispose();
        base.OnFormClosed(e);
    }

    private sealed record DeviceItem(string Id, string Name)
    {
        public override string ToString() => Name;
    }

    private sealed class Playback(AudioFileReader reader, WasapiOut output) : IDisposable
    {
        public void Dispose() { try { output.Stop(); } catch { } output.Dispose(); reader.Dispose(); }
    }
}
