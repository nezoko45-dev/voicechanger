using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using System.Windows.Forms;

namespace ChatGPTVoiceLoop;

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
    private readonly Label status = new()
    {
        AutoSize = true,
        MaximumSize = new System.Drawing.Size(520, 0),
        Text = "Ready. Open ChatGPT in Chrome, with the chat visible."
    };
    private readonly Button start = new() { Text = "Start ChatGPT voice", AutoSize = true };
    private readonly Button stop = new() { Text = "Stop", AutoSize = true, Enabled = false };
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 1500 };
    private bool active;

    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public MainForm()
    {
        Text = "ChatGPT Voice Loop — UI Automation";
        Width = 600;
        Height = 210;
        StartPosition = FormStartPosition.CenterScreen;
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
        var buttons = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
        buttons.Controls.Add(start);
        buttons.Controls.Add(stop);
        layout.Controls.Add(buttons);
        Controls.Add(layout);

        start.Click += Start_Click;
        stop.Click += (_, _) => StopVoice();
        timer.Tick += (_, _) => CheckChatGPT();
        FormClosing += (_, _) => timer.Stop();
    }

    private void Start_Click(object? sender, EventArgs e)
    {
        // Update the UI before attempting UI Automation so the click never appears to do nothing.
        status.Text = "Start clicked. Looking for the ChatGPT Chrome window…";
        start.Enabled = false;
        Refresh();
        Application.DoEvents();

        try
        {
            var window = FindChatGPTWindow();
            if (window is null)
            {
                status.Text = "Couldn't find a Chrome window titled ChatGPT. Click the ChatGPT tab in Chrome, then try Start again.";
                start.Enabled = true;
                return;
            }

            Activate(window);
            Thread.Sleep(500);
            window = FindChatGPTWindow() ?? window;

            var voice = FindVoiceControl(window);
            if (voice is null)
            {
                status.Text = "Found ChatGPT, but Chrome doesn't expose a named Voice button to UI Automation. Try maximising Chrome and ensure the message composer is visible.";
                start.Enabled = true;
                return;
            }

            InvokeControl(voice);
            active = true;
            stop.Enabled = true;
            timer.Start();
            status.Text = "Voice button activated. ChatGPT handles microphone recognition and spoken replies; this app does not use Windows speech synthesis or the David voice.";
        }
        catch (Exception ex)
        {
            status.Text = "Start failed: " + ex.GetType().Name + ": " + ex.Message;
            start.Enabled = true;
        }
    }

    private void StopVoice()
    {
        timer.Stop();
        active = false;
        start.Enabled = true;
        stop.Enabled = false;
        status.Text = "Stopped. Click Start ChatGPT voice to try again.";
    }

    private void CheckChatGPT()
    {
        if (!active) return;
        try
        {
            var window = FindChatGPTWindow();
            if (window is null)
            {
                status.Text = "ChatGPT window not found. Open the chat in Chrome and click Start again.";
                timer.Stop();
                active = false;
                start.Enabled = true;
                stop.Enabled = false;
                return;
            }

            foreach (AutomationElement item in window.FindAll(TreeScope.Descendants, Condition.TrueCondition))
            {
                var name = SafeName(item);
                if (name.Contains("end voice", StringComparison.OrdinalIgnoreCase) ||
                    name.Contains("stop voice", StringComparison.OrdinalIgnoreCase) ||
                    name.Contains("mute", StringComparison.OrdinalIgnoreCase))
                {
                    status.Text = "ChatGPT Voice appears active. Speak to ChatGPT directly; its own Voice Mode handles speech and replies.";
                    return;
                }
            }
            status.Text = "ChatGPT window is found. If Voice Mode didn't open, use the Voice button in ChatGPT and then click Stop here when finished.";
        }
        catch (Exception ex)
        {
            status.Text = "Monitoring UI Automation: " + ex.Message;
        }
    }

    private static AutomationElement? FindChatGPTWindow()
    {
        // First use actual Chrome processes and their top-level window handles.
        foreach (var process in Process.GetProcessesByName("chrome"))
        {
            try
            {
                if (process.MainWindowHandle == IntPtr.Zero) continue;
                var title = process.MainWindowTitle ?? "";
                if (title.Contains("ChatGPT", StringComparison.OrdinalIgnoreCase))
                {
                    var element = AutomationElement.FromHandle(process.MainWindowHandle);
                    if (element is not null) return element;
                }
            }
            catch { }
        }

        // Fallback to the UI Automation desktop tree, which handles Chrome title variations.
        try
        {
            var windows = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement window in windows)
            {
                var title = SafeName(window);
                if (title.Contains("ChatGPT", StringComparison.OrdinalIgnoreCase))
                    return window;
                try
                {
                    var tabs = window.FindAll(TreeScope.Descendants,
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem));
                    foreach (AutomationElement tab in tabs)
                        if (SafeName(tab).Contains("ChatGPT", StringComparison.OrdinalIgnoreCase))
                            return window;
                }
                catch { }
            }
        }
        catch { }
        return null;
    }

    private static void Activate(AutomationElement window)
    {
        try
        {
            var handle = new IntPtr(window.Current.NativeWindowHandle);
            if (handle != IntPtr.Zero)
            {
                ShowWindow(handle, 9);
                SetForegroundWindow(handle);
            }
            window.SetFocus();
        }
        catch { }
    }

    private static AutomationElement? FindVoiceControl(AutomationElement window)
    {
        try
        {
            var elements = window.FindAll(TreeScope.Descendants, Condition.TrueCondition);
            AutomationElement? fallback = null;
            foreach (AutomationElement element in elements)
            {
                try
                {
                    if (!element.Current.IsEnabled || element.Current.IsOffscreen) continue;
                    var name = SafeName(element);
                    if (string.IsNullOrWhiteSpace(name)) continue;

                    if (name.Contains("start voice conversation", StringComparison.OrdinalIgnoreCase) ||
                        name.Equals("voice mode", StringComparison.OrdinalIgnoreCase) ||
                        name.Equals("start voice", StringComparison.OrdinalIgnoreCase))
                        return element;

                    if (element.Current.ControlType == ControlType.Button &&
                        (name.Contains("voice", StringComparison.OrdinalIgnoreCase) ||
                         name.Contains("microphone", StringComparison.OrdinalIgnoreCase)))
                        fallback ??= element;
                }
                catch { }
            }
            return fallback;
        }
        catch { return null; }
    }

    private static void InvokeControl(AutomationElement element)
    {
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out var pattern))
        {
            ((InvokePattern)pattern).Invoke();
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

    private static string SafeName(AutomationElement element)
    {
        try { return element.Current.Name ?? ""; }
        catch { return ""; }
    }
}
