using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Net;
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
        private readonly Button start = new Button { Text = "START CHROME RECOGNITION", Dock = DockStyle.Top, Height = 45 };
        private readonly Button stop = new Button { Text = "STOP", Dock = DockStyle.Top, Height = 35, Enabled = false };
        private readonly CheckBox auto = new CheckBox { Text = "Send transcript to ChatGPT automatically", Dock = DockStyle.Top, Height = 36, Checked = true };
        private readonly Label status = new Label { Text = "Ready. Click Start, then allow microphone access in Chrome.", Dock = DockStyle.Fill, Padding = new Padding(12) };
        private LocalBridge bridge;
        private readonly System.Windows.Forms.Timer readTimer = new System.Windows.Forms.Timer { Interval = 1000 };\n        private bool waitingForResponse; private int responseWaitTicks;

        public MainForm()
        {
            Text = "ChatGPT Dictation — Chrome Speech"; Width = 560; Height = 250;
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
            Controls.Add(status); Controls.Add(auto); Controls.Add(stop); Controls.Add(start);
            start.Click += (s,e) => StartListening(); stop.Click += (s,e) => StopListening();
            readTimer.Tick += (s,e) => CheckResponseAndReadAloud();
            FormClosing += (s,e) => { readTimer.Stop(); try { bridge?.Dispose(); } catch {} };
            try {
                bridge = new LocalBridge();
                bridge.Transcript += phrase => { if (!IsDisposed) BeginInvoke((Action)(() => { status.Text = "Chrome recognized: " + phrase; if(auto.Checked) DeliverToChatGPT(phrase); })); };
                bridge.Start();
                status.Text += Environment.NewLine + "Local API: http://127.0.0.1:8765/health";
            } catch (Exception ex) { status.Text += Environment.NewLine + "Bridge error: " + ex.Message; }
        }

        private void StartListening()
        {
            try {
                Process.Start(new ProcessStartInfo("http://127.0.0.1:8765/recognizer") { UseShellExecute = true });
                start.Enabled = false; stop.Enabled = true;
                status.Text = "Chrome recognition page opened. Allow microphone, then click Start Mic on that page.";
            } catch(Exception ex) { status.Text = "Could not open Chrome recognition page: " + ex.Message; }
        }
        private void StopListening()
        {
            try { Process.Start(new ProcessStartInfo("http://127.0.0.1:8765/stop") { UseShellExecute = true }); } catch {}
            start.Enabled=true; stop.Enabled=false; readTimer.Stop();
            status.Text="Stopped Chrome recognition.";
        }
        private void InvokeReadAloud()
        {
            try {
                AutomationElement chrome=FindChrome(); if(chrome==null)return;
                AutomationElement button=FindNamedButton(chrome,"Read aloud");
                if(button!=null && button.TryGetCurrentPattern(InvokePattern.Pattern,out object pattern)) {
                    ((InvokePattern)pattern).Invoke(); status.Text += "\r\nRead Aloud clicked.";
                } else status.Text += "\r\nRead Aloud button not found yet.";
            } catch(Exception ex) { status.Text += "\r\nRead Aloud: "+ex.Message; }
        }
        private static Process FindChromeProcess()
        {
            foreach(Process p in Process.GetProcessesByName("chrome")) { try { if(p.MainWindowHandle!=IntPtr.Zero)return p; } catch {} } return null;
        }
        private static AutomationElement FindChrome()
        {
            Process p=FindChromeProcess(); if(p==null)return null;
            try{return AutomationElement.FromHandle(p.MainWindowHandle);}catch{return null;}
        }
        private static AutomationElement FindNamedButton(AutomationElement root,string name)
        {
            var buttons=root.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button));
            for(int i=buttons.Count-1;i>=0;i--) { try { if((buttons[i].Current.Name??"").IndexOf(name,StringComparison.OrdinalIgnoreCase)>=0)return buttons[i]; } catch{} }
            return null;
        }
    }

    public sealed class LocalBridge : IDisposable
    {
        private readonly ConcurrentQueue<string> queue=new ConcurrentQueue<string>();
        private HttpListener listener; private CancellationTokenSource cancel;
        public event Action<string> Transcript;
        public void Start(){listener=new HttpListener();listener.Prefixes.Add("http://127.0.0.1:8765/");listener.Start();cancel=new CancellationTokenSource();Task.Run(()=>Serve(cancel.Token));}
        public void Enqueue(string text){queue.Enqueue(text);Transcript?.Invoke(text);}
        private async Task Serve(CancellationToken token){
            while(!token.IsCancellationRequested&&listener.IsListening){
                HttpListenerContext c;try{c=await listener.GetContextAsync();}catch{break;}
                try{
                    c.Response.Headers["Access-Control-Allow-Origin"]="*";
                    c.Response.Headers["Access-Control-Allow-Methods"]="GET, POST, OPTIONS";
                    c.Response.Headers["Access-Control-Allow-Headers"]="Content-Type";
                    if(c.Request.HttpMethod=="OPTIONS"){c.Response.StatusCode=204;c.Response.Close();continue;}
                    string path=c.Request.Url.AbsolutePath.ToLowerInvariant(),body;
                    if(path=="/recognizer"){
                        string html=Page;
                        byte[] hb=Encoding.UTF8.GetBytes(html);c.Response.ContentType="text/html; charset=utf-8";c.Response.ContentLength64=hb.Length;await c.Response.OutputStream.WriteAsync(hb,0,hb.Length);c.Response.Close();continue;
                    }
                    if(path=="/transcript"&&c.Request.HttpMethod=="POST"){
                        using(var reader=new StreamReader(c.Request.InputStream,c.Request.ContentEncoding)){string phrase=(await reader.ReadToEndAsync()).Trim();if(phrase.Length>0)Enqueue(phrase);}
                        body="{\"ok\":true}"; 
                    } else if(path=="/stop"){body="{\"ok\":true,\"stop\":true}";}
                    else if(path=="/health")body="{\"ok\":true,\"service\":\"Chrome Web Speech Recognition localhost bridge\"}";
                    else if(path=="/next"){string x;body=queue.TryDequeue(out x)?"{\"text\":"+Json(x)+"}":"{\"text\":null}";}
                    else {c.Response.StatusCode=404;body="{\"error\":\"Use /health, /next, /recognizer or POST /transcript\"}";}
                    byte[] b=Encoding.UTF8.GetBytes(body);c.Response.ContentType="application/json; charset=utf-8";c.Response.ContentLength64=b.Length;await c.Response.OutputStream.WriteAsync(b,0,b.Length);c.Response.Close();
                }catch{try{c.Response.Close();}catch{}}
            }
        }
        private const string Page = @"<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>Chrome Dictation</title><style>body{font:16px system-ui;max-width:700px;margin:35px auto;padding:15px;background:#111827;color:#f9fafb}button{font-size:18px;padding:12px 18px;margin:8px;border:0;border-radius:9px}#start{background:#22c55e}#stop{background:#ef4444;color:white}#status{padding:12px;background:#263244;border-radius:8px;margin:15px 0}#text{white-space:pre-wrap;min-height:100px;padding:14px;background:#0b1220;border-radius:8px}</style></head><body><h1>🎙 Chrome Speech Recognition</h1><p>Allow microphone permission when Chrome asks. Keep this tab open while dictating.</p><button id='start'>Start Mic</button><button id='stop'>Stop</button><div id='status'>Ready. Click Start Mic.</div><h3>Transcript</h3><div id='text'></div><script>
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null,running=false,restart=null;
const status=document.getElementById('status'),out=document.getElementById('text');
function say(s){status.textContent=s}
async function post(t){try{await fetch('/transcript',{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:t})}catch(e){say('Local EXE bridge error: '+e.message)}}
function start(){if(!SR){say('SpeechRecognition unavailable. Use Google Chrome desktop.');return}running=true;clearTimeout(restart);rec=new SR();rec.lang='en-US';rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1;
rec.onstart=()=>say('🎤 Listening with Chrome…');rec.onerror=e=>say('Recognition error: '+e.error+' (check microphone permission)');rec.onresult=e=>{let interim='',finals='';for(let i=e.resultIndex;i<e.results.length;i++){let t=e.results[i][0].transcript;if(e.results[i].isFinal)finals+=t;else interim+=t}if(interim)out.textContent=interim;if(finals){out.textContent=finals;post(finals.trim());say('Sent transcript to EXE: '+finals.trim())}};
rec.onend=()=>{if(running){say('Chrome recognition restarting…');restart=setTimeout(()=>{try{rec.start()}catch(e){start()}},350)}else say('Stopped.')};try{rec.start()}catch(e){say('Could not start: '+e.message)}}
document.getElementById('start').onclick=start;document.getElementById('stop').onclick=()=>{running=false;clearTimeout(restart);try{rec&&rec.stop()}catch{}say('Stopped.')};
</script></body></html>";
        private static string Json(string x)=>"\""+x.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\r","\\r").Replace("\n","\\n")+"\"";
        public void Dispose(){try{cancel?.Cancel();listener?.Stop();listener?.Close();}catch{}}
    }
}