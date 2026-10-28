using System.Diagnostics;
using System.Windows.Automation;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace ChatGptAudioLoop;

internal sealed class LoopForm : Form
{
    private readonly ProgressBar meter = new() { Minimum = 0, Maximum = 100, Dock = DockStyle.Top, Height = 24 };
    private readonly Label levelText = new() { Text = "Microphone: starting…", AutoSize = true, Dock = DockStyle.Top, Padding = new Padding(0, 8, 0, 8) };
    private readonly Label status = new() { Text = "Stopped", AutoSize = true, Dock = DockStyle.Top, Padding = new Padding(0, 4, 0, 10) };
    private readonly NumericUpDown threshold = new() { Minimum = 1, Maximum = 30, Value = 3, Width = 70 };
    private readonly NumericUpDown silenceSeconds = new() { Minimum = 1, Maximum = 10, Value = 2, Width = 70 };
    private readonly Button start = new() { Text = "Start loop", AutoSize = true };
    private readonly Button stop = new() { Text = "Stop", AutoSize = true, Enabled = false };
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 150 };
    private WasapiCapture? capture;
    private volatile double rms;
    private DateTime lastVoice = DateTime.UtcNow;
    private DateTime lastAction = DateTime.MinValue;
    private DateTime actionTime = DateTime.MinValue;
    private int phase; // 0 waiting to dictate, 1 listening for end of speech, 2 waiting for reply, 3 waiting to read aloud
    private bool busy;

    public LoopForm()
    {
        Text = "ChatGPT Audio Loop";
        Width = 440; Height = 250;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        var layout = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(14), FlowDirection = FlowDirection.TopDown, WrapContents = false };
        layout.Controls.Add(new Label { Text = "ChatGPT must be open in a normal Chrome/Edge window.", AutoSize = true });
        layout.Controls.Add(levelText); layout.Controls.Add(meter);
        var settings = new FlowLayoutPanel { AutoSize = true, Width = 390 };
        settings.Controls.Add(new Label { Text = "Silence threshold (RMS %):", AutoSize = true, Padding = new Padding(0, 6, 0, 0) });
        settings.Controls.Add(threshold);
        settings.Controls.Add(new Label { Text = "Silence delay (sec):", AutoSize = true, Padding = new Padding(8, 6, 0, 0) });
        settings.Controls.Add(silenceSeconds);
        layout.Controls.Add(settings);
        var buttons = new FlowLayoutPanel { AutoSize = true }; buttons.Controls.Add(start); buttons.Controls.Add(stop); layout.Controls.Add(buttons);
        layout.Controls.Add(status); Controls.Add(layout);
        start.Click += (_, _) => BeginLoop(); stop.Click += (_, _) => StopLoop();
        timer.Tick += (_, _) => TickLoop();
        FormClosing += (_, _) => Cleanup();
    }

    private void BeginLoop()
    {
        try
        {
            capture = new WasapiCapture(new MMDeviceEnumerator().GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications));
            capture.DataAvailable += (_, e) => {
                var fmt = capture.WaveFormat;
                double sum = 0; int count = 0;
                if (fmt.Encoding == WaveFormatEncoding.IeeeFloat && fmt.BitsPerSample == 32)
                    for (int i = 0; i + 3 < e.BytesRecorded; i += 4) { float s = BitConverter.ToSingle(e.Buffer, i); if (float.IsFinite(s)) { sum += s * s; count++; } }
                else if (fmt.BitsPerSample == 16)
                    for (int i = 0; i + 1 < e.BytesRecorded; i += 2) { double s = BitConverter.ToInt16(e.Buffer, i) / 32768.0; sum += s * s; count++; }
                if (count > 0) rms = Math.Sqrt(sum / count);
            };
            capture.RecordingStopped += (_, e) => { if (e.Exception != null) BeginInvoke(() => status.Text = "Microphone error: " + e.Exception.Message); };
            capture.StartRecording();
            lastVoice = DateTime.UtcNow; lastAction = DateTime.MinValue; phase = 0; busy = false;
            start.Enabled = false; stop.Enabled = true; status.Text = "Monitoring microphone…"; timer.Start();
        }
        catch (Exception ex) { System.Windows.Forms.MessageBox.Show("Could not open the default microphone. Check Windows microphone permissions.\n\n" + ex.Message); }
    }

    private void TickLoop()
    {
        double value = rms;
        int percent = Math.Clamp((int)(value * 100 * 4), 0, 100);
        meter.Value = percent;
        levelText.Text = $"Microphone level: {percent}% (RMS {value:F3})";
        if (value > (double)threshold.Value / 100.0) lastVoice = DateTime.UtcNow;
        if (busy || DateTime.UtcNow - lastAction < TimeSpan.FromSeconds(2)) return;

        // Each stage is intentionally separated: dictate -> detect user silence -> send -> wait -> read aloud.
        if (phase == 0 && DateTime.UtcNow - lastVoice >= TimeSpan.FromSeconds(2))
        {
            if (ClickChatGPTButton(new[] { "Dictate", "Start dictation", "Dictation" }))
            { phase = 1; actionTime = DateTime.UtcNow; lastVoice = DateTime.UtcNow; status.Text = "Dictation started — speak now."; lastAction = DateTime.UtcNow; }
            else status.Text = "ChatGPT dictate button not found. Keep ChatGPT visible and signed in.";
        }
        else if (phase == 1 && DateTime.UtcNow - lastVoice >= TimeSpan.FromSeconds((double)silenceSeconds.Value) && DateTime.UtcNow - actionTime > TimeSpan.FromSeconds(2))
        {
            // Send only after speech has ended; this avoids sending while the user is talking.
            if (ClickChatGPTButton(new[] { "Send prompt", "Send", "Send message" }) || PressEnterOnComposer())
            { phase = 2; actionTime = DateTime.UtcNow; status.Text = "Sent — waiting for ChatGPT to finish…"; lastAction = DateTime.UtcNow; }
            else status.Text = "Speech paused, but Send wasn't found. Check ChatGPT's composer.";
        }
        else if (phase == 2 && DateTime.UtcNow - actionTime > TimeSpan.FromSeconds(8))
        {
            // Read aloud is only clicked after a response has had time to appear.
            if (ClickChatGPTButton(new[] { "Read aloud" }))
            { phase = 3; actionTime = DateTime.UtcNow; status.Text = "Reading reply aloud…"; lastAction = DateTime.UtcNow; }
        }
        else if (phase == 3 && DateTime.UtcNow - actionTime > TimeSpan.FromSeconds(3) && value < (double)threshold.Value / 100.0)
        {
            phase = 0; lastVoice = DateTime.UtcNow; status.Text = "Reply finished/quiet — preparing next dictation.";
        }
    }

    private bool ClickChatGPTButton(string[] names)
    {
        foreach (var p in BrowserProcesses())
        {
            try {
                if (p.MainWindowHandle == IntPtr.Zero) continue;
                var root = AutomationElement.FromHandle(p.MainWindowHandle);
                foreach (string name in names) {
                    var condition = new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
                        new PropertyCondition(AutomationElement.NameProperty, name, PropertyConditionFlags.IgnoreCase));
                    var el = root.FindFirst(TreeScope.Descendants, condition);
                    if (el != null && el.TryGetCurrentPattern(InvokePattern.Pattern, out var pattern)) { ((InvokePattern)pattern).Invoke(); return true; }
                }
            } catch { }
        }
        return false;
    }

    private bool PressEnterOnComposer()
    {
        foreach (var p in BrowserProcesses())
        {
            try {
                if (p.MainWindowHandle == IntPtr.Zero) continue;
                var root = AutomationElement.FromHandle(p.MainWindowHandle);
                var focused = AutomationElement.FocusedElement;
                if (focused != null && (focused.Current.ControlType == ControlType.Edit || focused.Current.ControlType == ControlType.Document)) {
                    System.Windows.Forms.SendKeys.SendWait("{ENTER}"); return true;
                }
            } catch { }
        }
        return false;
    }

    private static IEnumerable<Process> BrowserProcesses() => Process.GetProcesses().Where(p =>
        p.ProcessName.Contains("chrome", StringComparison.OrdinalIgnoreCase) ||
        p.ProcessName.Contains("msedge", StringComparison.OrdinalIgnoreCase));

    private void StopLoop()
    {
        timer.Stop(); try { capture?.StopRecording(); } catch { } capture?.Dispose(); capture = null;
        start.Enabled = true; stop.Enabled = false; status.Text = "Stopped"; phase = 0;
    }
    private void Cleanup() { timer.Stop(); try { capture?.StopRecording(); } catch { } capture?.Dispose(); }
}

internal static class Program
{
    [STAThread] static void Main() { ApplicationConfiguration.Initialize(); System.Windows.Forms.Application.Run(new LoopForm()); }
}
