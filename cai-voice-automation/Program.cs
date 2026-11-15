using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Diagnostics;
using System.Windows.Forms;

namespace CaiVoiceAutomation;
static class Program { [STAThread] static void Main(){ApplicationConfiguration.Initialize();Application.Run(new MainForm());} }

public class MainForm:Form {
 TextBox log=new(){Multiline=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill};
 Button start=new(){Text="Start",Dock=DockStyle.Top,Height=42};
 Label status=new(){Text="STOPPED",Dock=DockStyle.Top,Height=30};
 CancellationTokenSource? cts; HttpListener? listener; bool voiceOn=false,aiPlaying=false;
 DateTime lastSpeech=DateTime.MinValue,lastAudio=DateTime.MinValue; string? ws;
 const string Html=@"
<!doctype html><html><head><meta charset=utf-8><title>CAI Voice Automation — Speech Bridge</title>
<style>body{font:16px Segoe UI;background:#111827;color:#e5e7eb;padding:28px;max-width:700px;margin:auto}h1{color:#a5b4fc}button{padding:12px 18px;border:0;border-radius:9px;background:#6366f1;color:white;font-weight:600}#s{padding:12px;background:#1f2937;border-radius:8px;margin:16px 0}small{color:#9ca3af}</style></head><body>
<h1>🎙 CAI Speech Bridge</h1><p>This browser tab listens to your microphone and forwards recognized speech to the automation EXE.</p>
<button id=b>Start microphone</button><div id=s>Microphone: stopped</div><small>Keep this page open. Chrome may ask for microphone permission.</small>
<script>
const out=document.querySelector('#s'),btn=document.querySelector('#b');let r=null,active=false,retry=0;
function start(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){out.textContent='SpeechRecognition unavailable — use Chrome';return}
if(active)return;active=true;btn.textContent='Stop microphone';out.textContent='Microphone: starting…';
r=new SR();r.lang='en-US';r.continuous=true;r.interimResults=false;
r.onstart=()=>{out.textContent='🟢 Listening continuously';retry=0};
r.onresult=e=>{let t=e.results[e.results.length-1][0].transcript.trim();if(t){out.textContent='Heard: '+t;fetch('/speech?text='+encodeURIComponent(t)).catch(()=>{});}};
r.onerror=e=>{out.textContent='Recognition issue: '+e.error+' (restarting…)';};
r.onend=()=>{if(active){out.textContent='Recognition ended — restarting…';setTimeout(()=>{try{r.start()}catch{startFresh()}},350)}};
try{r.start()}catch{startFresh()}
}
function startFresh(){if(!active)return;try{r.onend=null;r.stop()}catch{};setTimeout(()=>{if(active){r=null;active=false;start()}},500)}
function stop(){active=false;try{r.stop()}catch{};btn.textContent='Start microphone';out.textContent='Microphone: stopped'}
btn.onclick=()=>active?stop():start();
</script></body></html>";
 public MainForm(){Text="CAI Voice Automation";Width=680;Height=460;Controls.Add(log);Controls.Add(status);Controls.Add(start);start.Click+=async(_,__)=>{if(cts!=null){cts.Cancel();return;}cts=new();start.Text="Stop";await Run(cts.Token);};FormClosing+=(_,__)=>cts?.Cancel();}
 void L(string s){if(IsDisposed)return;BeginInvoke(()=>log.AppendText($"[{DateTime.Now:HH:mm:ss}] {s}\r\n"));}
 async Task Run(CancellationToken ct){
 try{
  listener=new HttpListener();listener.Prefixes.Add("http://127.0.0.1:8765/");listener.Start();_=Serve(ct);
  Process.Start(new ProcessStartInfo("http://127.0.0.1:8765/"){UseShellExecute=true});
  status.Text="RUNNING • localhost:8765 • Chrome CDP :9222";L("HTML speech bridge opened at http://127.0.0.1:8765");
  using var http=new HttpClient();
  ClientWebSocket? cdp=null;int id=0;
  async Task<bool> Connect(){
   try{var tabs=JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json"));var tab=tabs.RootElement.EnumerateArray().FirstOrDefault(x=>x.GetProperty("url").GetString()?.Contains("character.ai",StringComparison.OrdinalIgnoreCase)==true);if(tab.ValueKind==JsonValueKind.Undefined){L("Waiting for Character.AI tab in Chrome debug…");return false;}ws=tab.GetProperty("webSocketDebuggerUrl").GetString();cdp=new ClientWebSocket();await cdp.ConnectAsync(new Uri(ws!),ct);L("Connected to Character.AI through Chrome debugging.");return true;}catch{L("Chrome debug not reachable. Launch Chrome with --remote-debugging-port=9222; retrying…");return false;}
  }
  async Task<string> Eval(string js){
   if(cdp==null||cdp.State!=WebSocketState.Open)return "";
   int thisId=Interlocked.Increment(ref id);var msg=JsonSerializer.Serialize(new{ id=thisId,method="Runtime.evaluate",@params=new{expression=js,returnByValue=true,awaitPromise=true}});await cdp.SendAsync(Encoding.UTF8.GetBytes(msg),WebSocketMessageType.Text,true,ct);var buf=new byte[65536];
   while(!ct.IsCancellationRequested){var r=await cdp.ReceiveAsync(buf,ct);using var d=JsonDocument.Parse(Encoding.UTF8.GetString(buf,0,r.Count));if(d.RootElement.TryGetProperty("id",out var got)&&got.GetInt32()==thisId){var rr=d.RootElement.GetProperty("result");if(rr.TryGetProperty("result",out var val)&&val.TryGetProperty("value",out var v))return v.ToString()??"";return "";}}
   return "";
  }
  while(!ct.IsCancellationRequested){
   if(cdp==null||cdp.State!=WebSocketState.Open){await Connect();await Task.Delay(1800,ct);continue;}
   try{
    var state=await Eval("JSON.stringify([...document.querySelectorAll('audio,video')].map(a=>({p:a.paused,e:a.ended,r:a.readyState,t:a.currentTime})))");
    bool playing=false;try{foreach(var a in JsonDocument.Parse(state).RootElement.EnumerateArray())if(!a.GetProperty("p").GetBoolean()&&!a.GetProperty("e").GetBoolean()&&a.GetProperty("r").GetInt32()>=2)playing=true;}catch{}
    if(playing){aiPlaying=true;lastAudio=DateTime.Now;}
    else if(aiPlaying&&DateTime.Now-lastAudio>TimeSpan.FromSeconds(2)){aiPlaying=false;L("Character.AI playback ended.");if(voiceOn){await Toggle(Eval);voiceOn=false;L("Voice SVG toggled OFF.");}}
    if(DateTime.Now-lastSpeech<TimeSpan.FromSeconds(2)&&!voiceOn){await Toggle(Eval);voiceOn=true;L("Voice SVG toggled ON (speech detected).");}
   }catch(Exception ex){L("CDP reconnect: "+ex.Message);try{cdp.Abort();cdp.Dispose();}catch{}cdp=null;}
   await Task.Delay(300,ct);
  }
 }catch(OperationCanceledException){}catch(Exception ex){L("ERROR: "+ex.Message);}finally{listener?.Stop();listener=null;cts=null;start.Text="Start";status.Text="STOPPED";L("Automation stopped.");}
 }
 async Task Toggle(Func<string,Task<string>> eval){
  var result=await eval("(()=>{let b=[...document.querySelectorAll('button')].find(x=>/voice|microphone|start voice|stop voice/i.test((x.getAttribute('aria-label')||'')+' '+(x.getAttribute('title')||'')+' '+(x.innerText||'')));if(!b)b=[...document.querySelectorAll('button,[role=button]')].find(x=>x.querySelector('svg')&&/voice|mic|audio/i.test(x.outerHTML));if(b){b.click();return 'clicked '+(b.getAttribute('aria-label')||b.title||b.innerText)}return 'NOT FOUND'})()");
  L("Voice control: "+result);
 }
 async Task Serve(CancellationToken ct){
  while(!ct.IsCancellationRequested&&listener?.IsListening==true){try{var c=await listener.GetContextAsync();if(c.Request.Url?.AbsolutePath=="/speech"){var t=c.Request.QueryString["text"];if(!string.IsNullOrWhiteSpace(t)){lastSpeech=DateTime.Now;L("Recognized: "+t);}c.Response.StatusCode=204;c.Response.Close();continue;}
   var bytes=Encoding.UTF8.GetBytes(Html);c.Response.ContentType="text/html; charset=utf-8";c.Response.ContentLength64=bytes.Length;await c.Response.OutputStream.WriteAsync(bytes);c.Response.Close();
  }catch{break;}}
 }
}