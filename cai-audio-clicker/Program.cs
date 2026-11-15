using System;
using System.Linq;
using System.Threading;
using System.Windows.Automation;

namespace CaiReplyAudioClicker
{
    internal static class Program
    {
        static void Main()
        {
            Console.Title = "CAI Reply Audio Clicker";
            Console.WriteLine("Watching Chrome / Character.AI. Keep CAI open; Ctrl+C to exit.");
            bool generatingSeen = false;
            while (true)
            {
                try
                {
                    var chrome = AutomationElement.RootElement.FindAll(
                        TreeScope.Children,
                        new PropertyCondition(AutomationElement.ClassNameProperty, "Chrome_WidgetWin_1"));
                    foreach (AutomationElement window in chrome)
                    {
                        var stop = FindGenerationStop(window);
                        if (stop != null) { generatingSeen = true; continue; }
                        if (!generatingSeen) continue;
                        Thread.Sleep(1200); // let final response controls render
                        var play = FindReadAloud(window);
                        if (play != null && TryInvoke(play))
                        {
                            Console.WriteLine(DateTime.Now.ToString("HH:mm:ss") + " Clicked reply Read Aloud.");
                            generatingSeen = false;
                            Thread.Sleep(1500);
                        }
                    }
                }
                catch (ElementNotAvailableException) { }
                catch (Exception ex) { Console.WriteLine("UIA: " + ex.Message); }
                Thread.Sleep(500);
            }
        }

        static AutomationElement FindGenerationStop(AutomationElement root)
        {
            var buttons = root.FindAll(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button));
            foreach (AutomationElement b in buttons)
            {
                string n = SafeName(b).ToLowerInvariant();
                if (n.Contains("stop generating") || n.Contains("stop response") ||
                    n.Contains("stop generation") || n.Contains("cancel generation"))
                    return b;
            }
            return null;
        }

        static AutomationElement FindReadAloud(AutomationElement root)
        {
            var buttons = root.FindAll(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button));
            AutomationElement fallback = null;
            foreach (AutomationElement b in buttons)
            {
                string n = SafeName(b).ToLowerInvariant();
                if (n.Contains("read aloud") || n.Contains("play audio") ||
                    n.Contains("listen to response") || n.Contains("listen"))
                    fallback = b;
            }
            return fallback;
        }

        static string SafeName(AutomationElement e)
        {
            try { return e.Current.Name ?? ""; } catch { return ""; }
        }

        static bool TryInvoke(AutomationElement e)
        {
            try
            {
                if (e.TryGetCurrentPattern(InvokePattern.Pattern, out object p))
                { ((InvokePattern)p).Invoke(); return true; }
                if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out object s))
                { ((SelectionItemPattern)s).Select(); return true; }
            }
            catch { }
            return false;
        }
    }
}