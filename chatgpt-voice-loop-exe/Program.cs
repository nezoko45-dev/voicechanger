using System.Diagnostics;
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
    private readonly Label status = new()
    {
        AutoSize = true,
        MaximumSize = new System.Drawing.Size(500, 0),
        Text = "Open ChatGPT in Chrome, sign in, and leave the chat visible."
    };
    private readonly Button start = new() { Text = "Start ChatGPT voice", AutoSize = true };
    private readonly Button stop = new() { Text = "Stop", AutoSize = true, Enabled = false };
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 1200 };
    private bool active;
    private bool clickedVoice;

    public MainForm()
    {
        Text = "ChatGPT Voice Loop — UI Automation";
        Width = 560;
        Height = 190;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        var layout = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(14),
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            AutoScroll = true
        };
        layout.Controls.Add(status);
        var buttons = new FlowLayoutPanel { AutoSize = true };
        buttons.Controls.Add(start);
        buttons.Controls.Add(stop);
        layout.Controls.Add(buttons);
        Controls.Add(layout);

        start.Click += (_, _) => StartVoice();
        stop.Click += (_, _) => StopVoice();
        timer.Tick += (_, _) => CheckChatGPT();
        FormClosing += (_, _) => timer.Stop();
    }

    private void StartVoice()
    {
        var window = FindChatGPTWindow();
        if (window is null)
        {
            status.Text = "ChatGPT window not found. Open chatgpt.com in Chrome and bring that tab to the foreground.";
            return;
        }

        try
        {
            window.SetFocus();
            var voiceButton = FindVoiceButton(window);
            if (voiceButton is null)
            {
                status.Text = "ChatGPT is open, but UI Automation couldn't identify its Voice/microphone button. Make sure the chat composer is visible.";
                return;
            }

            Click(voiceButton);
            active = true;
            clickedVoice = true;
            start.Enabled = false;
            stop.Enabled = true;
            timer.Start();
            status.Text = "Clicked ChatGPT's Voice button. Speak to ChatGPT; ChatGPT handles recognition and its spoken reply. No Windows/David voice is used.";
        }
        catch (Exception ex)
        {
            status.Text = "Couldn't activate ChatGPT Voice: " + ex.Message;
        }
    }

    private void StopVoice()
    {
        timer.Stop();
        active = false;
        clickedVoice = false;
        start.Enabled = true;
        stop.Enabled = false;
        status.Text = "Stopped. Use ChatGPT's Voice button again when ready.";
    }

    private void CheckChatGPT()
    {
        if (!active) return;
        var window = FindChatGPTWindow();
        if (window is null)
        {
            status.Text = "ChatGPT window not found. Voice loop is paused; bring the ChatGPT Chrome window back.";
            return;
        }

        try
        {
            var buttons = window.FindAll(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button));
            foreach (AutomationElement button in buttons)
            {
                var name = SafeName(button);
                if (name.Contains("End voice", StringComparison.OrdinalIgnoreCase) ||
                    name.Contains("Stop voice", StringComparison.OrdinalIgnoreCase))
                {
                    status.Text = "ChatGPT Voice is active. Speak naturally; ChatGPT handles the microphone and spoken responses.";
                    return;
                }
            }

            if (clickedVoice)
            {
                status.Text = "Voice was activated. If ChatGPT returned to text chat, click Start ChatGPT voice again.";
                clickedVoice = false;
            }
        }
        catch
        {
            // ChatGPT can rebuild its accessibility tree while switching voice states.
        }
    }

    private static AutomationElement? FindChatGPTWindow()
    {
        try
        {
            var root = AutomationElement.RootElement;
            var windows = root.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement window in windows)
            {
                try
                {
                    var title = window.Current.Name ?? "";
                    if (title.Contains("ChatGPT", StringComparison.OrdinalIgnoreCase) &&
                        (title.Contains("Chrome", StringComparison.OrdinalIgnoreCase) ||
                         title.Contains("Google Chrome", StringComparison.OrdinalIgnoreCase)))
                        return window;
                }
                catch { }
            }

            // Some Chrome builds expose the tab title without the browser name.
            foreach (AutomationElement window in windows)
            {
                try
                {
                    if ((window.Current.Name ?? "").Contains("ChatGPT", StringComparison.OrdinalIgnoreCase))
                        return window;
                }
                catch { }
            }
        }
        catch { }
        return null;
    }

    private static AutomationElement? FindVoiceButton(AutomationElement window)
    {
        try
        {
            var buttons = window.FindAll(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button));
            AutomationElement? fallback = null;
            foreach (AutomationElement button in buttons)
            {
                try
                {
                    if (button.Current.IsOffscreen || !button.Current.IsEnabled) continue;
                    var name = SafeName(button);
                    if (name.Contains("voice", StringComparison.OrdinalIgnoreCase) ||
                        name.Contains("microphone", StringComparison.OrdinalIgnoreCase) ||
                        name.Contains("start dictation", StringComparison.OrdinalIgnoreCase))
                    {
                        if (name.Contains("voice", StringComparison.OrdinalIgnoreCase) ||
                            name.Contains("microphone", StringComparison.OrdinalIgnoreCase))
                            return button;
                        fallback ??= button;
                    }
                }
                catch { }
            }
            return fallback;
        }
        catch { return null; }
    }

    private static string SafeName(AutomationElement element)
    {
        try { return element.Current.Name ?? ""; }
        catch { return ""; }
    }

    private static void Click(AutomationElement element)
    {
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out var invoke))
        {
            ((InvokePattern)invoke).Invoke();
            return;
        }
        if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var selection))
        {
            ((SelectionItemPattern)selection).Select();
            return;
        }
        element.SetFocus();
        SendKeys.SendWait("{ENTER}");
    }
}
