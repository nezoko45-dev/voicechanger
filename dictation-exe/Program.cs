using System;
using System.Collections.Concurrent;
using System.Globalization;
using System.Diagnostics;
using System.Net;
using System.Speech.Recognition;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace ChatGPTDictation
{
    internal static class Program
    {
        [STAThread] static void Main() { Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false); Application.Run(new MainForm()); }
    }

    public sealed class MainForm : Form
    {
        private readonly Button start = new Button { Text = "START LISTENING", Dock = DockStyle.Top, Height = 45 };
        private readonly Button stop = new Button { Text = "STOP", Dock = DockStyle.Top, Height = 35, Enabled = false };
        private readonly CheckBox auto = new CheckBox { Text = "Send transcript to ChatGPT + Read Aloud (Windows UI Automation)", Dock = DockStyle.Top, Height = 36, Checked = true };
        private readonly Label status = new Label { Text = "Ready. Open ChatGPT in Chrome, click its composer once, then Start.", Dock = DockStyle.Fill, Padding = new Padding(12) };
        private SpeechRecognitionEngine recognizer;
        private LocalBridge bridge;
        private readonly System.Windows.Forms.Timer readTimer = new System.Windows.Forms.Timer { Interval = 6500 };

        public MainForm()
        {
            Text = "ChatGPT Dictation — Windows UI Automation"; Width = 560; Height = 250;
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
            Controls.Add(status); Controls.Add(auto); Controls.Add(stop); Controls.Add(start);
            start.Click += async (s,e) => await StartListening(); stop.Click += (s,e) => StopListening();
            readTimer.Tick += (s,e) => { readTimer.Stop(); InvokeReadAloud(); };
            FormClosing += (s,e) => StopListening();
            try { bridge = new LocalBridge(); bridge.Start(); status.Text += Environment.NewLine + "Local test API: http://127.0.0.1:8765/health"; }
            catch (Exception ex) { status.Text += Environment.NewLine + "Bridge error: " + ex.Message; }
        }

        private async Task StartListening()
        {
            try {
                StopRecognizer();
                recognizer = new SpeechRecognitionEngine(CultureInfo.GetCultureInfo("en-US"));
                recognizer.SetInputToDefaultAudioDevice();
                recognizer.LoadGrammar(new DictationGrammar());
                recognizer.AudioStateChanged += (s,e) => BeginInvoke((Action)(() => status.Text = "Mic state: " + e.AudioState + " — speak now."));
                recognizer.SpeechDetected += (s,e) => BeginInvoke((Action)(() => status.Text = "🎙 Speech detected by microphone…"));
                recognizer.SpeechHypothesized += (s,e) => BeginInvoke((Action)(() => status.Text = "Recognizing: " + (e.Result?.Text ?? "(partial)")));
                recognizer.SpeechRecognitionRejected += (s,e) => BeginInvoke((Action)(() => status.Text = "Speech heard, but rejected. Try speaking clearly/closer."));
                recognizer.SpeechRecognized += (s,e) => {
                    if (e.Result == null || String.IsNullOrWhiteSpace(e.Result.Text)) return;
                    string phrase = e.Result.Text.Trim();
                    bridge?.Enqueue(phrase);
                    BeginInvoke((Action)(() => { status.Text = "Recognized: " + phrase + " (confidence " + e.Result.Confidence.ToString("0.00") + ")"; if(auto.Checked) SendToChatGPT(phrase); }));
                };
                recognizer.RecognizeAsync(RecognizeMode.Multiple);
                start.Enabled=false; stop.Enabled=true;
                status.Text="🎙 Starting microphone…";
            } catch(Exception ex) { status.Text="Mic/recognition error: "+ex.Message; StopListening(); }
            await Task.CompletedTask;
        }
        private void SendToChatGPT(string phrase)
        {
            try {
                Process chromeProcess = FindChromeProcess();
                if(chromeProcess == null) { status.Text += "\r\nChrome window not found—open ChatGPT."; return; }
                IntPtr hwnd = chromeProcess.MainWindowHandle;
                RECT rect; if(!GetWindowRect(hwnd,out rect)) { status.Text += "\r\nCould not get Chrome window bounds."; return; }

                // Critical: bring Chrome to the foreground so keyboard paste goes into its composer,
                // not into this EXE's own window.
                ShowWindow(hwnd, SW_RESTORE);
                SetForegroundWindow(hwnd);
                Thread.Sleep(350);

                // Click inside ChatGPT's composer (bottom-center of Chrome client area).
                int x = rect.Left + (rect.Right-rect.Left)/2;
                int y = rect.Bottom - 115;
                SetCursorPos(x,y); mouse_event(MOUSEEVENTF_LEFTDOWN,0,0,0,UIntPtr.Zero);
                mouse_event(MOUSEEVENTF_LEFTUP,0,0,0,UIntPtr.Zero);
                Thread.Sleep(300);
                Clipboard.SetText(phrase);
                SendKey(VK_CONTROL, true); SendKey(VK_V, true); SendKey(VK_V, false); SendKey(VK_CONTROL, false);
                Thread.Sleep(250); SendKey(VK_RETURN, true); SendKey(VK_RETURN, false);
                status.Text = "Pasted + sent to ChatGPT: " + phrase + "\r\nRead Aloud automation scheduled…";
                readTimer.Stop(); readTimer.Start();
            } catch(Exception ex) { status.Text="UI automation error: "+ex.Message; }
        }
        private void InvokeReadAloud()
        {
            try {
                AutomationElement chrome=FindChrome(); if(chrome==null)return;
                AutomationElement button=FindNamedButton(chrome,"Read aloud");
                if(button!=null && button.TryGetCurrentPattern(InvokePattern.Pattern,out object pattern)) {
                    ((InvokePattern)pattern).Invoke(); status.Text += "\r\nRead Aloud clicked.";
                } else status.Text += "\r\nRead Aloud button not found yet (try again after response finishes).";
            } catch(Exception ex) { status.Text += "\r\nRead Aloud: "+ex.Message; }
        }
        private static Process FindChromeProcess()
        {
            foreach(Process p in Process.GetProcessesByName("chrome")) {
                try { if(p.MainWindowHandle!=IntPtr.Zero)return p; } catch {}
            } return null;
        }
        private static AutomationElement FindChrome()
        {
            Process p=FindChromeProcess(); if(p==null)return null;
            try{return AutomationElement.FromHandle(p.MainWindowHandle);}catch{return null;}
        }
        [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left,Top,Right,Bottom; }
        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
        [DllImport("user32.dll")] private static extern bool SetCursorPos(int x,int y);
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd,int command);
        private const int SW_RESTORE=9;
        [DllImport("user32.dll")] private static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
        private const uint MOUSEEVENTF_LEFTDOWN=0x0002,MOUSEEVENTF_LEFTUP=0x0004;
        private static AutomationElement FindComposer(AutomationElement root)
        {
            var cond=new OrCondition(new PropertyCondition(AutomationElement.NameProperty,"Message ChatGPT"),new PropertyCondition(AutomationElement.NameProperty,"Ask anything"));
            var found=root.FindFirst(TreeScope.Descendants,cond); if(found!=null)return found;
            return root.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit));
        }
        private static AutomationElement FindNamedButton(AutomationElement root,string name)
        {
            var buttons=root.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button));
            for(int i=buttons.Count-1;i>=0;i--) { try { if((buttons[i].Current.Name??"").IndexOf(name,StringComparison.OrdinalIgnoreCase)>=0)return buttons[i]; } catch{} }
            return null;
        }
        private void StopRecognizer(){try{recognizer?.RecognizeAsyncCancel();recognizer?.RecognizeAsyncStop();recognizer?.Dispose();}catch{} recognizer=null;}
        private void StopListening(){StopRecognizer();readTimer.Stop();start.Enabled=true;stop.Enabled=false;if(!IsDisposed)status.Text="Stopped. Localhost remains available until the app closes.";}
        private const byte VK_CONTROL=0x11,VK_V=0x56,VK_RETURN=0x0D;
        [DllImport("user32.dll")] private static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
        private static void SendKey(byte key,bool down)=>keybd_event(key,0,down?0u:2u,UIntPtr.Zero);
    }

    public sealed class LocalBridge
    {
        private readonly ConcurrentQueue<string> queue=new ConcurrentQueue<string>(); private HttpListener listener; private CancellationTokenSource cancel;
        public void Start(){listener=new HttpListener();listener.Prefixes.Add("http://127.0.0.1:8765/");listener.Start();cancel=new CancellationTokenSource();Task.Run(()=>Serve(cancel.Token));}
        public void Enqueue(string text){queue.Enqueue(text);}
        private async Task Serve(CancellationToken token){while(!token.IsCancellationRequested&&listener.IsListening){HttpListenerContext c;try{c=await listener.GetContextAsync();}catch{break;}try{
            c.Response.Headers["Access-Control-Allow-Origin"]="*";c.Response.Headers["Access-Control-Allow-Methods"]="GET, OPTIONS";
            if(c.Request.HttpMethod=="OPTIONS"){c.Response.StatusCode=204;c.Response.Close();continue;}
            string path=c.Request.Url.AbsolutePath.ToLowerInvariant(),body;
            if(path=="/health")body="{\"ok\":true,\"service\":\"ChatGPT Dictation EXE + Windows UI Automation\"}";
            else if(path=="/next"){string x;body=queue.TryDequeue(out x)?"{\"text\":"+Json(x)+"}":"{\"text\":null}";}
            else {c.Response.StatusCode=404;body="{\"error\":\"Use /health or /next\"}";}
            byte[] b=Encoding.UTF8.GetBytes(body);c.Response.ContentType="application/json; charset=utf-8";c.Response.ContentLength64=b.Length;await c.Response.OutputStream.WriteAsync(b,0,b.Length);c.Response.Close();
        }catch{try{c.Response.Close();}catch{}}}}
        private static string Json(string x)=>"\""+x.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\r","\\r").Replace("\n","\\n")+"\"";
    }
}