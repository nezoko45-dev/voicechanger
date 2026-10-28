using System.Diagnostics;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Windows.Automation;
using System.Windows.Forms;

namespace ChatGPTVoiceLoop;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

internal sealed class MainForm : Form
{
    private readonly Label status = new() { AutoSize = true, Text = "Ready. Open ChatGPT in Chrome, then click Start." };
    private readonly Button start = new() { Text = "Start listening", AutoSize = true };
    private readonly Button stop = new() { Text = "Stop", AutoSize = true, Enabled = false };
    private readonly CheckBox readInput = new() { Text = "Read my dictated words aloud before sending", Checked = true, AutoSize = true };
    private readonly CheckBox readReply = new() { Text = "Read ChatGPT's reply aloud after sending", Checked = true, AutoSize = true };
    private readonly SpeechSynthesizer speaker = new();
    private SpeechRecognitionEngine? recognizer;
    private readonly System.Windows.Forms.Timer silenceTimer = new() { Interval = 2400 };
    private string pending = "";
    private bool busy;
    private DateTime lastSpeech = DateTime.MinValue;

    public MainForm()
    {
        Text = "ChatGPT Voice Loop";
        Width = 560; Height = 205;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        var layout = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(14), FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true };
        layout.Controls.Add(status); layout.Controls.Add(readInput); layout.Controls.Add(readReply);
        var buttons = new FlowLayoutPanel { AutoSize = true };
        buttons.Controls.Add(start); buttons.Controls.Add(stop); layout.Controls.Add(buttons);
        Controls.Add(layout);
        start.Click += (_, _) => StartListening();
        stop.Click += (_, _) => StopListening();
        silenceTimer.Tick += async (_, _) => await FlushIfQuiet();
        FormClosing += (_, _) => { StopListening(); speaker.Dispose(); };
    }

    private void StartListening()
    {
        try
        {
            recognizer?.Dispose();
            recognizer = new SpeechRecognitionEngine();
            recognizer.LoadGrammar(new DictationGrammar());
            recognizer.SetInputToDefaultAudioDevice();
            recognizer.SpeechRecognized += (_, e) =>
            {
                if (e.Result.Confidence < 0.48 || string.IsNullOrWhiteSpace(e.Result.Text)) return;
                BeginInvoke(new Action(() =>
                {
                    pending = (pending + " " + e.Result.Text).Trim();
                    lastSpeech = DateTime.Now;
                    status.Text = "Hearing: " + pending;
                    silenceTimer.Stop(); silenceTimer.Start();
                }));
            };
            recognizer.RecognizeAsync(RecognizeMode.Multiple);
            start.Enabled = false; stop.Enabled = true;
            status.Text = "Listening to your microphone…";
        }
        catch (Exception ex)
        {
            status.Text = "Could not start Windows speech recognition: " + ex.Message;
            MessageBox.Show(this, "Windows speech recognition could not start. Make sure a speech language is installed and configured.\n\n" + ex.Message, "ChatGPT Voice Loop");
        }
    }

    private void StopListening()
    {
        silenceTimer.Stop();
        try { recognizer?.RecognizeAsyncCancel(); recognizer?.Dispose(); } catch { }
        recognizer = null;
        start.Enabled = true; stop.Enabled = false;
        status.Text = "Stopped.";
    }

    private async Task FlushIfQuiet()
    {
        if (busy || pending.Length == 0 || (DateTime.Now - lastSpeech).TotalMilliseconds < 2100) return;
        silenceTimer.Stop();
        busy = true;
        string text = pending;
        pending = "";
        try
        {
            status.Text = "Preparing: " + text;
            if (readInput.Checked) await Task.Run(() => speaker.Speak(text));
            bool sent = await Task.Run(() => SendToChatGPT(text));
            if (!sent)
            {
                status.Text = "Couldn't find ChatGPT's message box. Click its message field and try again.";
                return;
            }
            status.Text = "Sent. Waiting for ChatGPT's reply…";
            if (readReply.Checked)
            {
                string? reply = await WaitForReplyAndReadAloud();
                status.Text = reply is null
                    ? "Sent. Reply read-aloud control wasn't found; click Read aloud manually."
                    : "Activated ChatGPT's Read aloud control.";
            }
            else status.Text = "Sent to ChatGPT.";
        }
        catch (Exception ex) { status.Text = "Error: " + ex.Message; }
        finally { busy = false; }
    }

    private static bool SendToChatGPT(string text)
    {
        var chrome = Process.GetProcessesByName("chrome").FirstOrDefault();
        var edge = Process.GetProcessesByName("msedge").FirstOrDefault();
        var root = AutomationElement.RootElement;
        var windows = root.FindAll(TreeScope.Children, Condition.TrueCondition);
        AutomationElement? targetWindow = null;
        foreach (AutomationElement win in windows)
        {
            try
            {
                var title = win.Current.Name ?? "";
                if ((title.Contains("ChatGPT", StringComparison.OrdinalIgnoreCase)) &&
                    (title.Contains("Chrome", StringComparison.OrdinalIgnoreCase) || title.Contains("Microsoft Edge", StringComparison.OrdinalIgnoreCase) || chrome is not null || edge is not null))
                { targetWindow = win; break; }
            } catch { }
        }
        targetWindow ??= GetForegroundWindowElement();
        if (targetWindow is null) return false;
        var edit = FindComposer(targetWindow);
        if (edit is null) return false;
        try
        {
            if (edit.TryGetCurrentPattern(ValuePattern.Pattern, out object vp))
                ((ValuePattern)vp).SetValue(text);
            else
            {
                edit.SetFocus();
                Clipboard.SetText(text);
                SendKeys.SendWait("^v");
            }
            edit.SetFocus();
            SendKeys.SendWait("{ENTER}");
            return true;
        }
        catch { return false; }
    }

    private static AutomationElement? GetForegroundWindowElement()
    {
        try
        {
            var focused = AutomationElement.FocusedElement;
            var current = focused;
            while (current is not null)
            {
                if (current.Current.ControlType == ControlType.Window) return current;
                current = TreeWalker.ControlViewWalker.GetParent(current);
            }
        } catch { }
        return null;
    }

    private static AutomationElement? FindComposer(AutomationElement root)
    {
        try
        {
            var all = root.FindAll(TreeScope.Descendants, Condition.TrueCondition);
            AutomationElement? fallback = null;
            foreach (AutomationElement el in all)
            {
                try
                {
                    var n = el.Current.Name ?? "";
                    if (el.Current.IsOffscreen) continue;
                    if (el.Current.ControlType == ControlType.Edit &&
                        (n.Contains("message", StringComparison.OrdinalIgnoreCase) ||
                         n.Contains("prompt", StringComparison.OrdinalIgnoreCase) ||
                         n.Contains("ChatGPT", StringComparison.OrdinalIgnoreCase))) return el;
                    if (el.Current.ControlType == ControlType.Edit && fallback is null) fallback = el;
                } catch { }
            }
            return fallback;
        } catch { return null; }
    }

    private async Task<string?> WaitForReplyAndReadAloud()
    {
        for (int i = 0; i < 120; i++)
        {
            await Task.Delay(1000);
            if (!VisibleChatGPTWindowExists()) continue;
            var root = GetForegroundWindowElement();
            if (root is null) continue;
            try
            {
                var buttons = root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button));
                foreach (AutomationElement b in buttons)
                {
                    var name = b.Current.Name ?? "";
                    if (name.Contains("Read aloud", StringComparison.OrdinalIgnoreCase) ||
                        name.Contains("Read Aloud", StringComparison.OrdinalIgnoreCase))
                    {
                        b.GetCurrentPattern(InvokePattern.Pattern);
                        ((InvokePattern)b.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
                        return name;
                    }
                }
            } catch { }
        }
        return null;
    }

    private static bool VisibleChatGPTWindowExists()
    {
        try { return GetForegroundWindowElement()?.Current.Name.Contains("ChatGPT", StringComparison.OrdinalIgnoreCase) == true; }
        catch { return false; }
    }
}