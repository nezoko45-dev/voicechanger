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
 CancellationTokenSource? cts; bool voiceOn=false,aiPlaying=false; DateTime lastSpeech=DateTime.MinValue,lastAudio=DateTime.MinValue;
 ClientWebSocket? cdp; int cdpId=0; readonly SemaphoreSlim cdpLock=new(1,1);
 public MainForm(){Text="CAI Voice Automation • Chrome Speech";Width=700;Height=480;Controls.Add(log);Controls.Add(status);Controls.Add(start);start.Click+=async(_,__)=>{if(cts!=null){cts.Cancel();return;}cts=new();start.Text="Stop";await Run(cts.Token);};FormClosing+=(_,__)=>cts?.Cancel();}
 void L(string s){if(IsDisposed)return;BeginInvoke(()=>log.AppendText($"[{DateTime.Now:HH:mm:ss}] {s}\r\n"));}
 async Task Run(CancellationToken ct){
 try{
  using var http=new HttpClient();bool ready=false;try{using var p=await http.GetAsync("http://127.0.0.1:9222/json/version",ct);ready=p.IsSuccessStatusCode;}catch{}
  if(!ready){string? chrome=FindChrome();if(chrome==null)throw new Exception("Chrome executable not found.");string profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CAIVoiceAutomation","ChromeDebugProfile");Directory.CreateDirectory(profile);
   Process.Start(new ProcessStartInfo(chrome){UseShellExecute=false,Arguments="--remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="+Quote(profile)+" --no-first-run --new-window https://character.ai"});L("Launched Chrome DEBUG on port 9222.");
   for(int i=0;i<30&&!ct.IsCancellationRequested;i++){try{using var p=await http.GetAsync("http://127.0.0.1:9222/json/version",ct);if(p.IsSuccessStatusCode){ready=true;break;}}catch{}await Task.Delay(500,ct);}
  }else L("Connected to existing Chrome DEBUG :9222.");
  if(!ready)throw new Exception("Chrome DevTools did not start on port 9222.");
  async Task<JsonDocument> Targets()=>JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json",ct));
  async Task<bool> HasCAI(){using var d=await Targets();return d.RootElement.EnumerateArray().Any(x=>(x.TryGetProperty("url",out var u)?u.GetString():"")?.Contains("character.ai",StringComparison.OrdinalIgnoreCase)==true);}
  if(!await HasCAI()){using var n=await http.PutAsync("http://127.0.0.1:9222/json/new?"+Uri.EscapeDataString("https://character.ai/"),new StringContent(""),ct);}
  for(int i=0;i<20&&!await HasCAI();i++)await Task.Delay(500,ct);
  if(!await Connect(http,ct))throw new Exception("Could not attach to the Character.AI Chrome tab.");
  // Chrome's native Web Speech API runs directly in the CAI page. No bridge HTML, localhost server, or Whisper model.
  string inject=@"
(()=>{if(window.__caiSpeechAutomation?.running)return 'already running';
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return 'SpeechRecognition unavailable in this Chrome page';
 const s=new SR();s.lang='en-US';s.continuous=true;s.interimResults=false;s.maxAlternatives=1;
 const q=window.__caiSpeechAutomation={running:true,queue:[],error:'',recognition:s};
 s.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal){let t=e.results[i][0].transcript.trim();if(t)q.queue.push(t)}}};
 s.onerror=e=>{q.error=e.error||'unknown';};s.onend=()=>{if(q.running)setTimeout(()=>{try{s.start()}catch{}},700)};
 try{s.start();return 'Chrome SpeechRecognition started in CAI tab'}catch(e){q.running=false;return 'Speech start failed: '+e.message}
})()";
  string init=await CdpEval(inject);L(init);
  if(init.Contains("unavailable")||init.Contains("failed"))throw new Exception(init+" — allow microphone access for character.ai and retry.");
  status.Text="RUNNING • Chrome SpeechRecognition • CDP";
  L("Speak normally. Chrome transcribes inside the CAI tab; EXE inserts transcript and presses Enter.");
  while(!ct.IsCancellationRequested){
   try{
    string transcript=await CdpEval("(()=>{let q=window.__caiSpeechAutomation;if(!q)return '';return q.queue.shift()||''})()");
    if(!string.IsNullOrWhiteSpace(transcript)){L("Heard: "+transcript);await Deliver(transcript);lastSpeech=DateTime.Now;}
    string state=await CdpEval("JSON.stringify([...document.querySelectorAll('audio,video')].map(a=>({p:a.paused,e:a.ended,r:a.readyState})))");
    bool playing=false;try{foreach(var a in JsonDocument.Parse(state).RootElement.EnumerateArray())if(!a.GetProperty("p").GetBoolean()&&!a.GetProperty("e").GetBoolean()&&a.GetProperty("r").GetInt32()>=2)playing=true;}catch{}
    if(playing){aiPlaying=true;lastAudio=DateTime.Now;}else if(aiPlaying&&DateTime.Now-lastAudio>TimeSpan.FromSeconds(2)){aiPlaying=false;L("CAI audio finished.");if(voiceOn){await ToggleVoice();voiceOn=false;}}
    if(DateTime.Now-lastSpeech<TimeSpan.FromSeconds(2)&&!voiceOn){await ToggleVoice();voiceOn=true;}
   }catch(Exception e){L("Monitor: "+e.Message);try{cdp?.Abort();cdp?.Dispose();}catch{}cdp=null;await Connect(http,ct);}
   await Task.Delay(350,ct);
  }
 }catch(OperationCanceledException){}catch(Exception e){L("ERROR: "+e.Message);}finally{try{await CdpEval("(()=>{let q=window.__caiSpeechAutomation;if(q){q.running=false;try{q.recognition.stop()}catch{};delete window.__caiSpeechAutomation}return 'stopped'})()");}catch{}try{cdp?.Abort();cdp?.Dispose();}catch{}cdp=null;cts=null;start.Text="Start";status.Text="STOPPED";L("Stopped.");}}
 async Task<bool> Connect(HttpClient http,CancellationToken ct){try{using var d=JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json",ct));JsonElement tab=default;foreach(var x in d.RootElement.EnumerateArray()){string u=x.TryGetProperty("url",out var uv)?uv.GetString()??"":"";if(u.Contains("character.ai",StringComparison.OrdinalIgnoreCase)){tab=x;break;}}if(tab.ValueKind==JsonValueKind.Undefined)return false;cdp=new ClientWebSocket();await cdp.ConnectAsync(new Uri(tab.GetProperty("webSocketDebuggerUrl").GetString()!),ct);await CdpEval("location.href");L("CDP attached: "+tab.GetProperty("url").GetString());return true;}catch(Exception e){L("CDP connect: "+e.Message);return false;}}
 async Task Deliver(string t){string enc=JsonSerializer.Serialize(t);string result=await CdpEval(@"(()=>{let t="+enc+@";let e=document.querySelector('textarea')||document.querySelector('[contenteditable=true]')||document.querySelector('[role=textbox]');if(!e)return 'CHAT INPUT NOT FOUND';e.focus();if(e.tagName==='TEXTAREA'||e.tagName==='INPUT'){let p=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;p.call(e,t);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t}));}else{document.execCommand('insertText',false,t);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t}));}return 'INSERTED'})()");
 L("Chat: "+result);if(result=="INSERTED"){await CdpKey("Enter");L("Enter pressed.");}}
 async Task ToggleVoice(){string r=await CdpEval(@"(()=>{let b=[...document.querySelectorAll('button,[role=button]')].find(x=>/voice|microphone|start voice|stop voice/i.test((x.getAttribute('aria-label')||'')+' '+(x.title||'')+' '+(x.innerText||'')));if(!b)b=[...document.querySelectorAll('button,[role=button]')].find(x=>x.querySelector('svg')&&/voice|mic|audio/i.test(x.outerHTML));if(b){b.click();return 'clicked '+(b.getAttribute('aria-label')||b.title||'voice')}return 'voice button not found'})()");L("Voice: "+r);}
 string? FindChrome(){string[] p={Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google","Chrome","Application","chrome.exe")};return p.FirstOrDefault(File.Exists);}
 string Quote(string s)=>"\""+s.Replace("\"","\\\"")+"\"";
 async Task<string> CdpEval(string js){await cdpLock.WaitAsync();try{if(cdp==null||cdp.State!=WebSocketState.Open)return "";int id=Interlocked.Increment(ref cdpId);string m=JsonSerializer.Serialize(new{id,method="Runtime.evaluate",@params=new{expression=js,returnByValue=true,awaitPromise=true}});await cdp.SendAsync(Encoding.UTF8.GetBytes(m),WebSocketMessageType.Text,true,CancellationToken.None);byte[] b=new byte[65536];while(true){var r=await cdp.ReceiveAsync(b,CancellationToken.None);using var d=JsonDocument.Parse(Encoding.UTF8.GetString(b,0,r.Count));if(d.RootElement.TryGetProperty("id",out var got)&&got.GetInt32()==id){var x=d.RootElement.GetProperty("result");if(x.TryGetProperty("result",out var v)&&v.TryGetProperty("value",out var z))return z.ToString()??"";if(x.TryGetProperty("exceptionDetails",out var ex))return "JS_ERROR "+ex;return "";}}}finally{cdpLock.Release();}}
 async Task CdpKey(string key){await cdpLock.WaitAsync();try{if(cdp==null||cdp.State!=WebSocketState.Open)return;async Task Send(string type){int id=Interlocked.Increment(ref cdpId);string m=JsonSerializer.Serialize(new{id,method="Input.dispatchKeyEvent",@params=new{type,key,code=key,windowsVirtualKeyCode=13,nativeVirtualKeyCode=13}});await cdp.SendAsync(Encoding.UTF8.GetBytes(m),WebSocketMessageType.Text,true,CancellationToken.None);byte[] b=new byte[65536];while(true){var r=await cdp.ReceiveAsync(b,CancellationToken.None);using var d=JsonDocument.Parse(Encoding.UTF8.GetString(b,0,r.Count));if(d.RootElement.TryGetProperty("id",out var got)&&got.GetInt32()==id)break;}}await Send("keyDown");await Send("keyUp");}finally{cdpLock.Release();}}
}