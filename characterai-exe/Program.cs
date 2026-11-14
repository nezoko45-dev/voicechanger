using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace CharacterAIDictation
{
    internal static class Program
    {
        [STAThread] static void Main() { Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false); Application.Run(new MainForm()); }
    }

    public sealed class MainForm : Form
    {
        private readonly Button start = new Button { Text = "START CONTINUOUS LISTENING", Dock = DockStyle.Top, Height = 45 };
        private readonly Button stop = new Button { Text = "STOP", Dock = DockStyle.Top, Height = 35, Enabled = false };
        private readonly CheckBox auto = new CheckBox { Text = "Send transcript to Character.AI automatically", Dock = DockStyle.Top, Height = 36, Checked = true };
        private readonly CheckBox keepVoice = new CheckBox { Text = "Keep Voice active (toggle every 5 seconds)", Dock = DockStyle.Top, Height = 36, Checked = false };
        private readonly System.Windows.Forms.Timer voiceTimer = new System.Windows.Forms.Timer { Interval = 5000 };
        private readonly Label status = new Label { Text = "Ready. Click Start, then allow microphone access in Chrome.", Dock = DockStyle.Fill, Padding = new Padding(12) };
        private LocalBridge bridge;
        private readonly System.Windows.Forms.Timer readTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        private bool waitingForResponse; private bool generationSeen; private int responseWaitTicks; private bool userSpeaking;
        private readonly Queue<string> pendingPhrases=new Queue<string>();

        public MainForm()
        {
            Text = "Character.AI Dictation — Chrome Speech"; Width = 560; Height = 250;
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
            Controls.Add(status); Controls.Add(keepVoice); Controls.Add(auto); Controls.Add(stop); Controls.Add(start);
            start.Click += (s,e) => StartListening(); stop.Click += (s,e) => StopListening();
            readTimer.Tick += (s,e) => CheckResponseAndReadAloud();
            voiceTimer.Tick += (s,e) => ToggleVoiceButton();
            keepVoice.CheckedChanged += (s,e) => { if(keepVoice.Checked && !waitingForResponse) { voiceTimer.Start(); status.Text = "Voice keep-alive enabled (5-second cycle)."; } else voiceTimer.Stop(); };
            FormClosing += (s,e) => { readTimer.Stop(); voiceTimer.Stop(); try { bridge?.Dispose(); } catch {} };
            try {
                bridge = new LocalBridge();
                bridge.Transcript += phrase => { if (!IsDisposed) BeginInvoke((Action)(() => { userSpeaking=false; status.Text = "Chrome recognized: " + phrase; if(auto.Checked) DeliverToCharacterAI(phrase); })); };
                bridge.SpeechStarted += () => { if(!IsDisposed) BeginInvoke((Action)(() => { userSpeaking=true; voiceTimer.Stop(); if(!waitingForResponse)status.Text="You are speaking — Voice keep-alive paused."; })); };
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
        private void DeliverToCharacterAI(string phrase)
        {
            voiceTimer.Stop(); waitingForResponse=true; generationSeen=false; responseWaitTicks=0; readTimer.Start();
            // Send every finalized Chrome SpeechRecognition result immediately.
            // Character.AI generation detection is unreliable across UI versions;
            // gating on its Stop button caused all later phrases to remain queued.
            try {
                AutomationElement chrome=FindCharacterAIChrome();
                if(chrome==null){status.Text="Character.AI Chrome window not found.";return;}
                AutomationElement field=FindCharacterTextbox(chrome);
                if(field==null){status.Text="Character.AI textbox not found. Open its chat tab and try again.";return;}

                // First try UI Automation's ValuePattern: this writes directly to the
                // actual accessible textbox and does not require coordinate clicking.
                object valuePattern;
                bool setDirectly=field.TryGetCurrentPattern(ValuePattern.Pattern,out valuePattern)
                    && !((ValuePattern)valuePattern).Current.IsReadOnly;
                if(setDirectly){
                    ((ValuePattern)valuePattern).SetValue(phrase.Trim());
                    AutomationElement send=FindSendButton(chrome);
                    object invokePattern;
                    if(send!=null && send.TryGetCurrentPattern(InvokePattern.Pattern,out invokePattern)){
                        ((InvokePattern)invokePattern).Invoke();
                    } else {
                        // Contenteditable implementations may expose ValuePattern but no
                        // accessible send button. Enter is the least invasive fallback.
                        field.SetFocus(); keybd_event(0x0D,0,0,UIntPtr.Zero);keybd_event(0x0D,0,2,UIntPtr.Zero);
                    }
                } else {
                    // Fallback for Chromium contenteditable fields without ValuePattern.
                    // SetFocus targets the discovered textbox (never a guessed screen point).
                    field.SetFocus();
                    Clipboard.SetText(phrase.Trim());
                    keybd_event(0x11,0,0,UIntPtr.Zero);keybd_event(0x56,0,0,UIntPtr.Zero);
                    keybd_event(0x56,0,2,UIntPtr.Zero);keybd_event(0x11,0,2,UIntPtr.Zero);
                    Thread.Sleep(80);
                    keybd_event(0x0D,0,0,UIntPtr.Zero);keybd_event(0x0D,0,2,UIntPtr.Zero);
                }
                status.Text="Sent transcript to Character.AI: "+phrase+" — waiting for response…";
            } catch(Exception ex){status.Text="Textbox send failed: "+ex.Message;}
        }

        private static AutomationElement FindCharacterTextbox(AutomationElement root)
        {
            AutomationElement best=null;int bestScore=-1;
            AutomationElementCollection all=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);
            for(int i=0;i<all.Count;i++){
                try{
                    AutomationElement e=all[i];ControlType type=e.Current.ControlType;
                    if(type!=ControlType.Edit && type!=ControlType.Document && type!=ControlType.Custom)continue;
                    string name=(e.Current.Name??"").ToLowerInvariant();
                    string aid=(e.Current.AutomationId??"").ToLowerInvariant();
                    string help=(e.Current.HelpText??"").ToLowerInvariant();
                    System.Windows.Rect b=e.Current.BoundingRectangle;
                    if(b.IsEmpty||b.Width<80||b.Height<15)continue;
                    if(name.Contains("address")||name.Contains("search")||aid.Contains("omnibox"))continue;
                    int score=0;
                    if(name.Contains("message"))score+=100;
                    if(name.Contains("chat"))score+=70;
                    if(name.Contains("type"))score+=45;
                    if(name.Contains("reply"))score+=40;
                    if(name.Contains("input"))score+=30;
                    if(aid.Contains("message")||aid.Contains("chat"))score+=60;
                    if(help.Contains("message")||help.Contains("chat"))score+=40;
                    if(e.Current.IsKeyboardFocusable)score+=10;
                    // Character.AI's composer is near the bottom of the page.
                    if(b.Top>root.Current.BoundingRectangle.Top+80)score+=5;
                    if(score>bestScore){best=e;bestScore=score;}
                }catch{}
            }
            return bestScore>=10?best:null;
        }

        private static AutomationElement FindSendButton(AutomationElement root)
        {
            AutomationElementCollection all=root.FindAll(TreeScope.Descendants,Condition.TrueCondition);
            for(int i=all.Count-1;i>=0;i--){
                try{
                    string n=(all[i].Current.Name??"").Trim();
                    if((n.Equals("Send",StringComparison.OrdinalIgnoreCase)||
                        n.Equals("Send message",StringComparison.OrdinalIgnoreCase)||
                        n.Equals("Send chat",StringComparison.OrdinalIgnoreCase))&&
                        all[i].Current.ControlType==ControlType.Button)return all[i];
                }catch{}
            }
            return null;
        }
        private void CheckResponseAndReadAloud()
        {
            if(!waitingForResponse)return;
            responseWaitTicks++;
            try {
                AutomationElement chrome=FindCharacterAIChrome();
                AutomationElement stopButton=chrome==null?null:FindNamedButton(chrome,"Stop generating");
                if(stopButton!=null){generationSeen=true;responseWaitTicks=0;status.Text="Character.AI is generating…";return;}
                if(generationSeen && responseWaitTicks>=3){
                    waitingForResponse=false;readTimer.Stop();
                    status.Text="Response finished. Voice keep-alive resumed.";
                    if(keepVoice.Checked)voiceTimer.Start();
                    return;
                }
                if(responseWaitTicks>90){
                    waitingForResponse=false;readTimer.Stop();status.Text="Response wait timed out; Voice keep-alive resumed.";
                    if(keepVoice.Checked)voiceTimer.Start();
                }
            } catch { if(responseWaitTicks>90){waitingForResponse=false;readTimer.Stop();if(keepVoice.Checked)voiceTimer.Start();} }
        }
        private void ToggleVoiceButton()
        {
            if(!keepVoice.Checked || waitingForResponse)return;
            try {
                AutomationElement chrome=FindCharacterAIChrome();
                if(chrome==null){status.Text="Voice keep-alive: Character.AI Chrome window not found.";return;}
                AutomationElement voice=null;
                var all=chrome.FindAll(TreeScope.Descendants,Condition.TrueCondition);
                for(int i=all.Count-1;i>=0;i--){
                    try {
                        string n=(all[i].Current.Name??"").Trim();
                        if(all[i].Current.ControlType==ControlType.Button &&
                           (n.Equals("Voice",StringComparison.OrdinalIgnoreCase) ||
                            n.Equals("Voice chat",StringComparison.OrdinalIgnoreCase) ||
                            n.Equals("Talk",StringComparison.OrdinalIgnoreCase))){voice=all[i];break;}
                    }catch{}
                }
                if(voice==null){status.Text="Voice keep-alive: Voice button not exposed by Character.AI UI.";return;}
                object pattern;
                if(voice.TryGetCurrentPattern(InvokePattern.Pattern,out pattern)){
                    ((InvokePattern)pattern).Invoke();
                    status.Text="Character.AI Voice button toggled (5-second keep-alive).";
                } else status.Text="Voice button found, but UI Automation cannot invoke it.";
            }catch(Exception ex){status.Text="Voice keep-alive error: "+ex.Message;}
        }
        private void SendNextQueued(){if(pendingPhrases.Count>0){string next=pendingPhrases.Dequeue();DeliverToCharacterAI(next);}}
        [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left,Top,Right,Bottom; }
        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd,out RECT rect);
        [DllImport("user32.dll")] private static extern bool SetCursorPos(int X,int Y);
        [DllImport("user32.dll")] private static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
        [DllImport("user32.dll")] private static extern void keybd_event(byte vk,byte scan,uint flags,UIntPtr extra);

        private void InvokeReadAloud()
        {
            try {
                AutomationElement chrome=FindChrome();
                if(chrome==null){status.Text += "\\r\\nChrome UI not available.";return;}

                // Search every accessible element, not only Button controls:
                // Chromium sometimes exposes the speaker toolbar as a custom control.
                AutomationElement target=null;
                var all=chrome.FindAll(TreeScope.Descendants,Condition.TrueCondition);
                for(int i=all.Count-1;i>=0;i--){
                    try {
                        string name=all[i].Current.Name??"";
                        if(name.IndexOf("Read aloud",StringComparison.OrdinalIgnoreCase)>=0 ||
                           name.IndexOf("Read Aloud",StringComparison.OrdinalIgnoreCase)>=0){
                            target=all[i];break;
                        }
                    } catch {}
                }
                if(target==null){status.Text += "\\r\\nCould not locate the Read aloud icon in Chrome UI.";return;}

                // Preferred: invoke the actual accessible icon.
                object pattern;
                if(target.TryGetCurrentPattern(InvokePattern.Pattern,out pattern)){
                    ((InvokePattern)pattern).Invoke();
                    status.Text += "\\r\\nRead Aloud icon invoked.";
                    return;
                }

                // Fallback: click the exact icon's UIA bounding rectangle.
                System.Windows.Rect bounds=target.Current.BoundingRectangle;
                if(!bounds.IsEmpty && bounds.Width>0 && bounds.Height>0){
                    SetCursorPos((int)(bounds.Left+bounds.Width/2),(int)(bounds.Top+bounds.Height/2));
                    mouse_event(0x0002,0,0,0,UIntPtr.Zero);
                    mouse_event(0x0004,0,0,0,UIntPtr.Zero);
                    status.Text += "\\r\\nClicked Read Aloud icon.";
                } else status.Text += "\\r\\nRead Aloud icon has no clickable bounds.";
            } catch(Exception ex) { status.Text += "\\r\\nRead Aloud click failed: "+ex.Message; }
        }
        private static Process FindChromeProcess()
        {
            Process fallback=null;
            foreach(Process p in Process.GetProcessesByName("chrome")) {
                try {
                    if(p.MainWindowHandle==IntPtr.Zero)continue;
                    if(fallback==null)fallback=p;
                    string title=p.MainWindowTitle??"";
                    if(title.IndexOf("Character.AI",StringComparison.OrdinalIgnoreCase)>=0||
                       title.IndexOf("character.ai",StringComparison.OrdinalIgnoreCase)>=0)return p;
                } catch {}
            }
            return fallback;
        }
        private static AutomationElement FindCharacterAIChrome()
        {
            foreach(Process p in Process.GetProcessesByName("chrome")){
                try{
                    if(p.MainWindowHandle==IntPtr.Zero)continue;
                    string title=p.MainWindowTitle??"";
                    if(title.IndexOf("Character.AI",StringComparison.OrdinalIgnoreCase)>=0 ||
                       title.IndexOf("character.ai",StringComparison.OrdinalIgnoreCase)>=0)
                        return AutomationElement.FromHandle(p.MainWindowHandle);
                }catch{}
            }
            return FindChrome();
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
        public event Action SpeechStarted;
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
                    } else if(path=="/speech-start"&&c.Request.HttpMethod=="POST"){SpeechStarted?.Invoke();body="{\"ok\":true}";}
                    else if(path=="/stop"){body="{\"ok\":true,\"stop\":true}";}
                    else if(path=="/health")body="{\"ok\":true,\"service\":\"Chrome Web Speech Recognition localhost bridge\"}";
                    else if(path=="/next"){string x;body=queue.TryDequeue(out x)?"{\"text\":"+Json(x)+"}":"{\"text\":null}";}
                    else {c.Response.StatusCode=404;body="{\"error\":\"Use /health, /next, /recognizer or POST /transcript\"}";}
                    byte[] b=Encoding.UTF8.GetBytes(body);c.Response.ContentType="application/json; charset=utf-8";c.Response.ContentLength64=b.Length;await c.Response.OutputStream.WriteAsync(b,0,b.Length);c.Response.Close();
                }catch{try{c.Response.Close();}catch{}}
            }
        }
        private const string Page = @"<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>Chrome Dictation</title><style>body{font:16px system-ui;max-width:700px;margin:35px auto;padding:15px;background:#111827;color:#f9fafb}button{font-size:18px;padding:12px 18px;margin:8px;border:0;border-radius:9px}#start{background:#22c55e}#stop{background:#ef4444;color:white}#status{padding:12px;background:#263244;border-radius:8px;margin:15px 0}#text{white-space:pre-wrap;min-height:100px;padding:14px;background:#0b1220;border-radius:8px}</style></head><body><h1>🎙 Chrome Speech Recognition</h1><p>Allow microphone permission when Chrome asks. Keep this tab open while dictating.</p><button id='start'>Start Mic</button><button id='stop'>Stop</button><div id='status'>Ready. Click Start Mic.</div><h3>Transcript</h3><div id='text'></div><script>
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null,running=false,restart=null;window.speaking=false;
const status=document.getElementById('status'),out=document.getElementById('text');
function say(s){status.textContent=s}
async function post(t){try{await fetch('/transcript',{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:t})}catch(e){say('Local EXE bridge error: '+e.message)}}
function start(){if(!SR){say('SpeechRecognition unavailable. Use Google Chrome desktop.');return}running=true;clearTimeout(restart);rec=new SR();rec.lang='en-US';rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1;
rec.onstart=()=>say('🎤 Listening with Chrome…');rec.onerror=e=>say('Recognition error: '+e.error+' (check microphone permission)');rec.onresult=e=>{let interim='',finals='';for(let i=e.resultIndex;i<e.results.length;i++){let t=e.results[i][0].transcript;if(e.results[i].isFinal)finals+=t;else interim+=t}if(interim){out.textContent=interim;if(!window.speaking){window.speaking=true;fetch('/speech-start',{method:'POST'}).catch(()=>{})}}if(finals){window.speaking=false;out.textContent=finals;post(finals.trim());say('Sent transcript to EXE: '+finals.trim())}};
rec.onend=()=>{if(running){say('Chrome recognition restarting…');restart=setTimeout(()=>{try{rec.start()}catch(e){start()}},350)}else say('Stopped.')};try{rec.start()}catch(e){say('Could not start: '+e.message)}}
document.getElementById('start').onclick=start;document.getElementById('stop').onclick=()=>{running=false;clearTimeout(restart);try{rec&&rec.stop()}catch{}say('Stopped.')};
</script></body></html>";
        private static string Json(string x)=>"\""+x.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\r","\\r").Replace("\n","\\n")+"\"";
        public void Dispose(){try{cancel?.Cancel();listener?.Stop();listener?.Close();}catch{}}
    }
}