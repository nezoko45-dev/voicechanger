using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace AudioWatchdog;

internal static class Program
{
    private static readonly object Gate = new();
    private static double micLevel;
    private static double outputLevel;
    private static DateTime micLastHeard = DateTime.MinValue;
    private static DateTime outputLastHeard = DateTime.MinValue;
    private static DateTime lastRecovery = DateTime.MinValue;
    private static volatile bool running = true;
    private static NotifyIcon? tray;
    private static WasapiCapture? mic;
    private static WasapiLoopbackCapture? loopback;

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        tray = new NotifyIcon
        {
            Icon = System.Drawing.SystemIcons.Information,
            Text = "Audio Watchdog: monitoring",
            Visible = true,
            ContextMenuStrip = new ContextMenuStrip()
        };
        tray.ContextMenuStrip.Items.Add("Check status", null, (_, _) => Notify("Monitoring microphone and speaker levels."));
        tray.ContextMenuStrip.Items.Add("Exit", null, (_, _) => { running = false; Application.Exit(); });
        tray.ShowBalloonTip(3500, "Audio Watchdog started", "Speak into your microphone. If mic activity continues but Google read-aloud output stays silent, the webpage will be restarted.", ToolTipIcon.Info);

        try
        {
            StartCapture();
            while (running)
            {
                Thread.Sleep(500);
                Evaluate();
            }
        }
        catch (Exception ex)
        {
            Notify("Audio Watchdog error: " + ex.Message);
            Thread.Sleep(5000);
        }
        finally
        {
            try { mic?.StopRecording(); } catch { }
            try { loopback?.StopRecording(); } catch { }
            mic?.Dispose();
            loopback?.Dispose();
            if (tray is not null) { tray.Visible = false; tray.Dispose(); }
        }
    }

    private static void StartCapture()
    {
        var devices = new MMDeviceEnumerator();
        mic = new WasapiCapture(devices.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications));
        loopback = new WasapiLoopbackCapture(devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia));
        mic.DataAvailable += (_, e) => UpdateLevel(e.Buffer, e.BytesRecorded, mic!.WaveFormat, true);
        loopback.DataAvailable += (_, e) => UpdateLevel(e.Buffer, e.BytesRecorded, loopback!.WaveFormat, false);
        mic.RecordingStopped += (_, e) => { if (e.Exception is not null) Notify("Microphone capture stopped: " + e.Exception.Message); };
        loopback.RecordingStopped += (_, e) => { if (e.Exception is not null) Notify("Speaker capture stopped: " + e.Exception.Message); };
        mic.StartRecording();
        loopback.StartRecording();
    }

    private static void UpdateLevel(byte[] buffer, int bytes, WaveFormat format, bool isMic)
    {
        if (bytes <= 0) return;
        double sum = 0;
        int count = 0;
        if (format.Encoding == WaveFormatEncoding.IeeeFloat && format.BitsPerSample == 32)
        {
            for (int i = 0; i + 3 < bytes; i += 4)
            {
                float sample = BitConverter.ToSingle(buffer, i);
                if (float.IsFinite(sample)) { sum += sample * sample; count++; }
            }
        }
        else if (format.BitsPerSample == 16)
        {
            for (int i = 0; i + 1 < bytes; i += 2)
            {
                short sample = BitConverter.ToInt16(buffer, i);
                double value = sample / 32768.0;
                sum += value * value; count++;
            }
        }
        if (count == 0) return;
        double rms = Math.Sqrt(sum / count);
        lock (Gate)
        {
            if (isMic)
            {
                micLevel = rms;
                if (rms > 0.012) micLastHeard = DateTime.UtcNow;
            }
            else
            {
                outputLevel = rms;
                if (rms > 0.004) outputLastHeard = DateTime.UtcNow;
            }
        }
    }

    private static void Evaluate()
    {
        double m, o;
        DateTime micHeard, outputHeard;
        lock (Gate) { m = micLevel; o = outputLevel; micHeard = micLastHeard; outputHeard = outputLastHeard; }
        var now = DateTime.UtcNow;

        // Only recover when the microphone has recently contained speech-level audio,
        // output has remained quiet, and a cooldown prevents repeated button clicking.
        bool userSpeaking = now - micHeard < TimeSpan.FromSeconds(4);
        bool outputSilent = now - outputHeard > TimeSpan.FromSeconds(16);
        bool micHasActivity = m > 0.012;
        bool outputIsQuiet = o < 0.004;
        if (userSpeaking && micHasActivity && outputSilent && outputIsQuiet &&
            now - lastRecovery > TimeSpan.FromSeconds(30))
        {
            lastRecovery = now;
            Notify("Possible read-aloud stall detected. Restarting webpage dictation…");
            bool success = RestartDictationButtons();
            Notify(success
                ? "Clicked Stop and Start dictation to recover the page."
                : "Could not find Stop/Start dictation buttons. Bring the dictation webpage to the foreground and ensure its buttons are visible.");
        }
    }

    private static bool RestartDictationButtons()
    {
        try
        {
            var browsers = Process.GetProcesses().Where(p =>
            {
                try { return p.ProcessName.Contains("chrome", StringComparison.OrdinalIgnoreCase) ||
                             p.ProcessName.Contains("msedge", StringComparison.OrdinalIgnoreCase); }
                catch { return false; }
            }).ToArray();

            foreach (var process in browsers)
            {
                AutomationElement? root = null;
                try
                {
                    if (process.MainWindowHandle == IntPtr.Zero) continue;
                    root = AutomationElement.FromHandle(process.MainWindowHandle);
                    var stop = FindButton(root, "Stop");
                    var start = FindButton(root, "Start dictation");
                    if (stop is null || start is null) continue;
                    if (stop.TryGetCurrentPattern(InvokePattern.Pattern, out object stopPattern))
                    {
                        ((InvokePattern)stopPattern).Invoke();
                        Thread.Sleep(900);
                        // Re-query the tree after the page changes its button states.
                        root = AutomationElement.FromHandle(process.MainWindowHandle);
                        start = FindButton(root, "Start dictation");
                        if (start is not null && start.TryGetCurrentPattern(InvokePattern.Pattern, out object startPattern))
                        {
                            ((InvokePattern)startPattern).Invoke();
                            return true;
                        }
                    }
                }
                catch { /* Try another browser window. */ }
            }
        }
        catch { }
        return false;
    }

    private static AutomationElement? FindButton(AutomationElement root, string name)
    {
        var condition = new AndCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
            new PropertyCondition(AutomationElement.NameProperty, name));
        return root.FindFirst(TreeScope.Descendants, condition);
    }

    private static void Notify(string message)
    {
        try
        {
            if (tray is not null) tray.ShowBalloonTip(2500, "Audio Watchdog", message, ToolTipIcon.Info);
        }
        catch { }
    }
}
