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
        MaximumSize = new System.Drawing.Size(540, 0),
        Text = "Open ChatGPT in Chrome. Start focuses the message box and opens Windows voice typing (Win+H)."
    };
    private readonly Button start = new() { Text = "Start dictation loop", AutoSize = true };
    private readonly Button stop = new() { Text = "Stop", AutoSize = true, Enabled = false };
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 1000 };
    private bool active;
    private string lastComposerText = "";
    private DateTime lastTextChange = DateTime.MinValue;
    private bool waitingForReply;
    private DateTime sendTime;
    private bool clickedReadAloudForCurrentReply;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;

    public MainForm()
    {
        Text = "ChatGPT Voice Loop — Dictation + Read Aloud";
        Width = 620;
        Height = 230;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;

        var layout = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill, Padding = new Padding(14),
            FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true
        };
        layout.Controls.Add(status);
        var buttons = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
        buttons.Controls.Add(start);
        buttons.Controls.Add(stop);
        layout.Controls.Add(buttons);
        Controls.Add(layout);

        start.Click += Start_Click;
        stop.Click += (_, _) => StopLoop();
        timer.Tick += (_, _) => TickLoop();
        FormClosing += (_, _) => timer.Stop();
    }

    private void Start_Click(object? sender, EventArgs e)
    {
        status.Text = "Start clicked. Finding ChatGPT and its message box…";
        start.Enabled = false;
        Refresh();
        Application.DoEvents();

        try
        {
            var window = FindChatGPTWindow();
            if (window is null)
            {
                status.Text = "ChatGPT Chrome window not found. Open chatgpt.com in Chrome and make that tab visible.";
                start.Enabled = true;
                return;
            }

            Activate(window);
            Thread.Sleep(400);
            window = FindChatGPTWindow() ?? window;
            var composer = FindComposer(window);
            if (composer is null)
            {
                // Fallback: click the bottom-center of the ChatGPT content area,
                // where the message composer normally sits, then query the focused element.
                // This avoids requiring Chrome to expose the contenteditable in its UIA tree.
                ClickComposerArea(window);
                Thread.Sleep(350);
                composer = FindComposer(window) ?? TryGetFocusedElement();
            }
            if (composer is null)
            {
                status.Text = "Couldn't focus ChatGPT's composer. Maximize the ChatGPT Chrome window and make sure chatgpt.com is the active tab, then try again.";
                start.Enabled = true;
                return;
            }

            try { composer.SetFocus(); } catch { }
            SendKeys.SendWait("^{END}");
            Thread.Sleep(150);
            // Open Windows Voice Typing without sending Ctrl+Esc or other keys that steal focus.
            // SendKeys does not reliably support the Windows key, so let the user invoke Win+H.
            status.Text = "Composer focused. Press Win+H to start Windows Voice Typing, then speak.";

            active = true;
            stop.Enabled = true;
            waitingForReply = false;
            clickedReadAloudForCurrentReply = false;
            lastComposerText = ReadValue(composer);
            lastTextChange = DateTime.UtcNow;
            timer.Start();
            status.Text = "Dictation loop started. Windows Voice Typing should be open; speak into the ChatGPT text box. I'll send stable text and click Read aloud when the reply appears.";
        }
        catch (Exception ex)
        {
            status.Text = "Start failed: " + ex.GetType().Name + ": " + ex.Message;
            start.Enabled = true;
        }
    }

    private void StopLoop()
    {
        timer.Stop();
        active = false;
        waitingForReply = false;
        start.Enabled = true;
        stop.Enabled = false;
        status.Text = "Stopped. No Windows text-to-speech is used.";
    }

    private void TickLoop()
    {
        if (!active) return;
        try
        {
            var window = FindChatGPTWindow();
            if (window is null) { status.Text = "ChatGPT window not found; loop paused."; return; }

            if (!waitingForReply)
            {
                var composer = FindComposer(window);
                if (composer is not null)
                {
                    var text = ReadValue(composer);
                    if (!string.Equals(text, lastComposerText, StringComparison.Ordinal))
                    {
                        lastComposerText = text;
                        lastTextChange = DateTime.UtcNow;
                        status.Text = "Dictation detected. Waiting for you to finish speaking…";
                    }
                    else if (!string.IsNullOrWhiteSpace(text) &&
                             DateTime.UtcNow - lastTextChange > TimeSpan.FromSeconds(3))
                    {
                        Activate(window);
                        composer.SetFocus();
                        SendKeys.SendWait("{ENTER}");
                        waitingForReply = true;
                        sendTime = DateTime.UtcNow;
                        clickedReadAloudForCurrentReply = false;
                        lastComposerText = "";
                        status.Text = "Sent dictated text. Waiting for the AI reply…";
                    }
                }
            }
            else if (DateTime.UtcNow - sendTime > TimeSpan.FromSeconds(2))
            {
                var readAloud = FindReadAloudButton(window);
                if (readAloud is not null && !clickedReadAloudForCurrentReply)
                {
                    InvokeControl(readAloud);
                    clickedReadAloudForCurrentReply = true;
                    waitingForReply = false;
                    lastComposerText = "";
                    lastTextChange = DateTime.UtcNow;
                    status.Text = "Clicked Read aloud for the reply. Speak again when playback finishes.";
                }
                else if (DateTime.UtcNow - sendTime > TimeSpan.FromSeconds(90))
                {
                    waitingForReply = false;
                    status.Text = "Timed out waiting for Read aloud. The response may still be generating; you can keep dictating.";
                }
            }
        }
        catch (Exception ex)
        {
            status.Text = "UI Automation issue: " + ex.Message;
        }
    }

    private static AutomationElement? FindChatGPTWindow()
    {
        foreach (var process in Process.GetProcessesByName("chrome"))
        {
            try
            {
                if (process.MainWindowHandle == IntPtr.Zero) continue;
                if ((process.MainWindowTitle ?? "").Contains("ChatGPT", StringComparison.OrdinalIgnoreCase))
                    return AutomationElement.FromHandle(process.MainWindowHandle);
            }
            catch { }
        }
        try
        {
            var windows = AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition);
            foreach (AutomationElement window in windows)
            {
                if (SafeName(window).Contains("ChatGPT", StringComparison.OrdinalIgnoreCase))
                    return window;
                try
                {
                    var tabs = window.FindAll(TreeScope.Descendants,
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem));
                    foreach (AutomationElement tab in tabs)
                        if (SafeName(tab).Contains("ChatGPT", StringComparison.OrdinalIgnoreCase)) return window;
                }
                catch { }
            }
        }
        catch { }
        return null;
    }

    private static AutomationElement? FindComposer(AutomationElement window)
    {
        // Best signal: if the user clicked ChatGPT's composer, Chrome may expose it
        // as the focused element even when the accessibility tree omits its name.
        try
        {
            var focused = AutomationElement.FocusedElement;
            if (focused is not null && IsWithinWindow(focused, window))
            {
                var focusedType = focused.Current.ControlType;
                var focusedName = SafeName(focused);
                if (IsTextEntryType(focusedType) ||
                    LooksLikeComposerName(focusedName))
                    return focused;
            }
        }
        catch { }

        try
        {
            var all = window.FindAll(TreeScope.Descendants, Condition.TrueCondition);
            AutomationElement? fallback = null;
            foreach (AutomationElement element in all)
            {
                try
                {
                    var current = element.Current;
                    if (!current.IsEnabled || current.IsOffscreen) continue;

                    var type = current.ControlType;
                    if (!IsTextEntryType(type) && type != ControlType.Custom &&
                        type != ControlType.Pane)
                        continue;

                    var name = SafeName(element);
                    if (LooksLikeComposerName(name))
                        return element;

                    // Keep a fallback only for a real text-entry control.
                    if (fallback is null && IsTextEntryType(type) &&
                        current.IsKeyboardFocusable)
                        fallback = element;
                }
                catch { }
            }
            if (fallback is not null) return fallback;
        }
        catch { }

        return null;
    }

    private static AutomationElement? TryGetFocusedElement()
    {
        try
        {
            var focused = AutomationElement.FocusedElement;
            if (focused is null) return null;
            var type = focused.Current.ControlType;
            return IsTextEntryType(type) || type == ControlType.Custom ||
                   type == ControlType.Pane ? focused : null;
        }
        catch { return null; }
    }

    private static void ClickComposerArea(AutomationElement window)
    {
        try
        {
            var hwnd = new IntPtr(window.Current.NativeWindowHandle);
            if (hwnd == IntPtr.Zero || !GetWindowRect(hwnd, out var rect)) return;
            int x = rect.Left + (rect.Right - rect.Left) / 2;
            int y = rect.Bottom - Math.Min(115, Math.Max(70, (rect.Bottom - rect.Top) / 8));
            SetCursorPos(x, y);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
        }
        catch { }
    }

    private static bool IsTextEntryType(ControlType type) =>
        type == ControlType.Edit || type == ControlType.Document;

    private static bool LooksLikeComposerName(string name) =>
        name.Contains("chat with chatgpt", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("ask anything", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("send a message", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("message chatgpt", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("message to chatgpt", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("write a message", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("prompt", StringComparison.OrdinalIgnoreCase) ||
        name.Equals("message", StringComparison.OrdinalIgnoreCase);

    private static bool IsWithinWindow(AutomationElement element, AutomationElement window)
    {
        try
        {
            var elementWindow = AutomationTreeWalker.ControlViewWalker.GetParent(element);
            while (elementWindow is not null)
            {
                if (elementWindow.Equals(window)) return true;
                elementWindow = AutomationTreeWalker.ControlViewWalker.GetParent(elementWindow);
            }
        }
        catch { }
        return false;
    }
    private static AutomationElement? FindReadAloudButton(AutomationElement window)
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
                    if (!button.Current.IsEnabled || button.Current.IsOffscreen) continue;
                    var name = SafeName(button);
                    if (name.Contains("read aloud", StringComparison.OrdinalIgnoreCase) ||
                        name.Contains("read response", StringComparison.OrdinalIgnoreCase))
                        return button;
                    if (name.Equals("listen", StringComparison.OrdinalIgnoreCase)) fallback ??= button;
                }
                catch { }
            }
            return fallback;
        }
        catch { return null; }
    }

    private static string ReadValue(AutomationElement element)
    {
        try
        {
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var value))
                return ((ValuePattern)value).Current.Value ?? "";
            if (element.TryGetCurrentPattern(TextPattern.Pattern, out var text))
                return ((TextPattern)text).DocumentRange.GetText(-1) ?? "";
        }
        catch { }
        return "";
    }

    private static void Activate(AutomationElement window)
    {
        try
        {
            var hwnd = new IntPtr(window.Current.NativeWindowHandle);
            if (hwnd != IntPtr.Zero) { ShowWindow(hwnd, 9); SetForegroundWindow(hwnd); }
            window.SetFocus();
        }
        catch { }
    }

    private static void InvokeControl(AutomationElement element)
    {
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out var pattern))
        {
            ((InvokePattern)pattern).Invoke();
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
