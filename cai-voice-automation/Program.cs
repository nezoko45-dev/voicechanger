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
 DateTime lastSpeech=DateTime.MinValue,lastAudio=DateTime.MinValue; string? ws; ClientWebSocket? cdp; int cdpId=0;
 const string Html=@"
<!doctype html><html><head><meta charset=utf-8><title>CAI Voice Bridge</title><style>
body{font:16px Segoe UI;background:#111827;color:#eee;padding:25px;max-width:760px;margin:auto}button{padding:12px;border:0;border-radius:8px;background:#6366f1;color:white}#s{padding:12px;background:#1f2937;margin:14px 0}input{padding:9px;width:65%}</style></head><body>
<h2>🎙 Chrome Speech → Character.AI bridge</h2><p>Speech is recognized here, then delivered directly into your Character.AI Chrome-debug tab.</p>
<button id=start>Start mic</button> <button id=test>Test connection</button><div id=s>Idle</div>
<p><input id=manual placeholder='Type a test message'><button id=send>Send to CAI</button></p><small>Keep this tab open. Chrome microphone permission is required.</small>
<script>
const S=document.querySelector('#s');let rec,active=false;
async function post(t){let r=await fetch('/speech',{method:'POST',headers:{'Content-Type':'text/plain'},body:t});S.textContent=await r.text()}
document.querySelector('#test').onclick=()=>post('__bridge_test__');
document.querySelector('#send').onclick=()=>post(document.querySelector('#manual').value);
document.querySelector('#start').onclick=()=>{if(active){active=false;try{rec.stop()}catch{};return}
let SR=SpeechRecognition||webkitSpeechRecognition;if(!SR){S.textContent='SpeechRecognition unavailable. Open this in Chrome.';return}
active=true;rec=new SR();rec.lang='en-US';rec.continuous=true;rec.interimResults=false;
rec.onstart=()=>S.textContent='🟢 Listening';rec.onresult=e=>{let t=e.results[e.results.length-1][0].transcript.trim();S.textContent='Recognized: '+t;post(t)};
rec.onerror=e=>S.textContent='Mic error: '+e.error+' (will recover)';
rec.onend=()=>{if(active)setTimeout(()=>{try{rec.start()}catch{}},400)};try{rec.start()}catch{}};
</script></body></html>";
 public MainForm(){Text="CAI Voice Automation";Width=680;Height=460;Controls.Add(log);Controls.Add(status);Controls.Add(start);start.Click+=async(_,__)=>{if(cts!=null){cts.Cancel();return;}cts=new();start.Text="Stop";await Run(cts.Token);};FormClosing+=(_,__)=>cts?.Cancel();}
 void L(string s){if(IsDisposed)return;BeginInvoke(()=>log.AppendText($"[{DateTime.Now:HH:mm:ss}] {s}\r\n"));}
 async Task Run(CancellationToken ct){
 try{
  listener=new HttpListener();listener.Prefixes.Add("http://127.0.0.1:8765/");listener.Start();_=Serve(ct);
  Process.Start(new ProcessStartInfo("http://127.0.0.1:8765/"){UseShellExecute=true});
  status.Text="RUNNING • speech page :8765 • CDP :9222";L("Browser bridge open.");
  using var http=new HttpClient();
  async Task<bool> Connect(){
   try{var tabs=JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json"));JsonElement tab=default;
    foreach(var x in tabs.RootElement.EnumerateArray()){var u=x.TryGetProperty("url",out var uv)?uv.GetString():"";if(u!=null&&(u.Contains("character.ai",StringComparison.OrdinalIgnoreCase)||u.Contains("c.ai",StringComparison.OrdinalIgnoreCase))){tab=x;break;}}
    if(tab.ValueKind==JsonValueKind.Undefined){L("CDP: no CAI tab found yet; retrying…");return false;}
    ws=tab.GetProperty("webSocketDebuggerUrl").GetString();cdp=new ClientWebSocket();await cdp.ConnectAsync(new Uri(ws!),ct);
    await CdpEval("(()=>{window.__voiceBridgeReady=true;return location.href})()");
    L("CDP ATTACHED to CAI tab: "+tab.GetProperty("url").GetString());return true;
   }catch(Exception e){L("CDP connect failed: "+e.Message+" (retrying)");return false;}
  }
  while(!ct.IsCancellationRequested){
   if(cdp==null||cdp.State!=WebSocketState.Open){await Connect();await Task.Delay(1500,ct);continue;}
   try{
    var state=await CdpEval("JSON.stringify([...document.querySelectorAll('audio,video')].map(a=>({p:a.paused,e:a.ended,r:a.readyState,t:a.currentTime})))");
    bool playing=false;try{foreach(var a in JsonDocument.Parse(state).RootElement.EnumerateArray())if(!a.GetProperty("p").GetBoolean()&&!a.GetProperty("e").GetBoolean()&&a.GetProperty("r").GetInt32()>=2)playing=true;}catch{}
    if(playing){aiPlaying=true;lastAudio=DateTime.Now;}
    else if(aiPlaying&&DateTime.Now-lastAudio>TimeSpan.FromSeconds(2)){aiPlaying=false;L("CAI audio ended.");if(voiceOn){await ToggleVoice();voiceOn=false;}}
    if(DateTime.Now-lastSpeech<TimeSpan.FromSeconds(2)&&!voiceOn){await ToggleVoice();voiceOn=true;}
   }catch(Exception ex){L("CDP issue: "+ex.Message);try{cdp.Abort();cdp.Dispose();}catch{}cdp=null;}
   await Task.Delay(300,ct);
  }
 }catch(OperationCanceledException){}catch(Exception ex){L("ERROR: "+ex.Message);}finally{listener?.Stop();listener=null;try{cdp?.Abort();cdp?.Dispose();}catch{}cdp=null;cts=null;start.Text="Start";status.Text="STOPPED";L("Stopped.");}
 }
 async Task<string> CdpEval(string js){
  if(cdp==null||cdp.State!=WebSocketState.Open)return "";
  int id=Interlocked.Increment(ref cdpId);var msg=JsonSerializer.Serialize(new{ id,method="Runtime.evaluate",@params=new{expression=js,returnByValue=true,awaitPromise=true}});await cdp.SendAsync(Encoding.UTF8.GetBytes(msg),WebSocketMessageType.Text,true,CancellationToken.None);var buf=new byte[65536];
  while(true){var r=await cdp.ReceiveAsync(buf,CancellationToken.None);using var d=JsonDocument.Parse(Encoding.UTF8.GetString(buf,0,r.Count));if(d.RootElement.TryGetProperty("id",out var got)&&got.GetInt32()==id){var rr=d.RootElement.GetProperty("result");if(rr.TryGetProperty("result",out var val)&&val.TryGetProperty("value",out var v))return v.ToString()??"";if(rr.TryGetProperty("exceptionDetails",out var er))return "JS_ERROR "+er.ToString();return "";}}
 }
 async Task ToggleVoice(){var x=await CdpEval("(()=>{let b=[...document.querySelectorAll('button,[role=button]')].find(x=>/voice|microphone|start voice|stop voice/i.test((x.getAttribute('aria-label')||'')+' '+(x.getAttribute('title')||'')+' '+(x.innerText||'')));if(!b)b=[...document.querySelectorAll('button,[role=button]')].find(x=>x.querySelector('svg')&&/voice|mic|audio/i.test(x.outerHTML));if(b){b.click();return 'CLICKED '+(b.getAttribute('aria-label')||b.title||b.innerText)}return 'VOICE BUTTON NOT FOUND'})()");L("Voice toggle: "+x);}
 async Task Serve(CancellationToken ct){
  while(!ct.IsCancellationRequested&&listener?.IsListening==true){try{var c=await listener.GetContextAsync();
   if(c.Request.Url?.AbsolutePath=="/speech"){using var sr=new StreamReader(c.Request.InputStream,c.Request.ContentEncoding);var t=await sr.ReadToEndAsync();if(t=="__bridge_test__"){var ack=await CdpEval("location.href");var b=Encoding.UTF8.GetBytes("CDP target: "+ack);c.Response.StatusCode=200;c.Response.ContentType="text/plain";await c.Response.OutputStream.WriteAsync(b);c.Response.Close();continue;}
    if(!string.IsNullOrWhiteSpace(t)){lastSpeech=DateTime.Now;L("Speech: "+t);var encoded=JsonSerializer.Serialize(t);var result=await CdpEval("(()=>{let t="+encoded+";let e=document.querySelector('textarea')||document.querySelector('[contenteditable=true]');if(!e)return 'CHAT INPUT NOT FOUND';e.focus();if(e.tagName==='TEXTAREA'){let p=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;p.call(e,t);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t}));}else{e.focus();document.execCommand('insertText',false,t);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t}));}
let kd=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true});e.dispatchEvent(kd);e.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));return 'TEXT INSERTED + ENTER'})()");L("Delivery/send: "+result);}
    c.Response.StatusCode=200;c.Response.ContentType="text/plain";var ok=Encoding.UTF8.GetBytes("Delivered to CAI tab");await c.Response.OutputStream.WriteAsync(ok);c.Response.Close();continue;}
   var bytes=Encoding.UTF8.GetBytes(Html);c.Response.ContentType="text/html; charset=utf-8";c.Response.ContentLength64=bytes.Length;await c.Response.OutputStream.WriteAsync(bytes);c.Response.Close();
  }catch(Exception e){L("Bridge server: "+e.Message);break;}}
 }
}