using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace ChromeCaiBridge;
public sealed class MainForm : Form {
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd,int nCmdShow);
 [DllImport("kernel32.dll")] static extern bool SetPriorityClass(IntPtr hProcess,uint dwPriorityClass);
 [DllImport("kernel32.dll")] static extern bool SetProcessPriorityBoost(IntPtr hProcess,bool DisablePriorityBoost);
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 const int SW_SHOWNOACTIVATE=4, SW_MINIMIZE=6; const uint NORMAL_PRIORITY_CLASS=0x20, ABOVE_NORMAL_PRIORITY_CLASS=0x8000;
 Process debugChrome; bool minimizedAfterComposerClick; int composerWatchBusy;
 ClientWebSocket sendSocket; readonly SemaphoreSlim cdpSendLock=new(1,1); int cdpCommandId=100;
 readonly HttpListener listener=new();
 readonly HttpClient cdpHttp=new(){Timeout=TimeSpan.FromSeconds(2)};
 readonly TextBox output=new(){Multiline=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill};
 readonly CheckBox send=new(){Text="Send recognized final phrases to c.ai",Checked=true,AutoSize=true};
 readonly CheckBox keepalive=new(){Text="Auto-recover c.ai audio",Checked=true,AutoSize=true};
 readonly Label status=new(){AutoSize=true,Text="Starting…"};
 readonly string profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ChromeCaiBridge","DebugProfile");
 DateTime lastSpeech=DateTime.UtcNow; bool disposed,waitingReply,sawGenerating,isIdle=true,replyGenerationFinished,replyAudioStarted; int generationPolls; int monitorBusy,voiceBusy; DateTime lastChromeAudio=DateTime.UtcNow; bool audioSeen;
 const string SvgPathPrefix="M8 3a1 1 0 0 1 1 1v7.105l2-1.473";
 public MainForm(){
  Text="Chrome c.ai Voice Bridge (Debug Chrome)";Width=820;Height=540;
  var bar=new FlowLayoutPanel{Dock=DockStyle.Top,Height=105};
  var launch=new Button{Text="Launch debug Chrome + c.ai",AutoSize=true};launch.Click+=(s,e)=>LaunchDebugChrome();
  var open=new Button{Text="Open Chrome recognition",AutoSize=true};open.Click+=(s,e)=>Process.Start(new ProcessStartInfo("http://127.0.0.1:8765/"){UseShellExecute=true});
  bar.Controls.Add(launch);bar.Controls.Add(open);bar.Controls.Add(send);bar.Controls.Add(keepalive);bar.Controls.Add(status);Controls.Add(output);Controls.Add(bar);
  Shown+=(s,e)=>{try{listener.Prefixes.Add("http://127.0.0.1:8765/");listener.Start();status.Text="Speech bridge ready";_=Serve();}catch(Exception ex){Log("Listener failed: "+ex.Message);} LaunchDebugChrome();};
  var timer=new System.Windows.Forms.Timer{Interval=5000};timer.Tick+=(s,e)=>{if(keepalive.Checked&&Interlocked.Exchange(ref voiceBusy,1)==0)_=AudioRecoveryTickAsync();};timer.Start();
  var composerWatch=new System.Windows.Forms.Timer{Interval=2500};composerWatch.Tick+=(s,e)=>{if(!minimizedAfterComposerClick&&debugChrome!=null&&Interlocked.Exchange(ref composerWatchBusy,1)==0)_=WatchComposerFocusAsync();};composerWatch.Start();
  var monitor=new System.Windows.Forms.Timer{Interval=4000};monitor.Tick+=(s,e)=>{if(waitingReply&&Interlocked.Exchange(ref monitorBusy,1)==0)_=CheckGenerationGuardedAsync();};monitor.Start();
  FormClosing+=(s,e)=>{disposed=true;try{listener.Stop();}catch{}};
 }
 void LaunchDebugChrome(){
  try{
   Directory.CreateDirectory(profile);
   string[] paths={Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google","Chrome","Application","chrome.exe")};
   string chrome=Array.Find(paths,File.Exists);
   if(chrome==null){Log("Chrome executable not found. Install Google Chrome.");return;}
   var psi=new ProcessStartInfo(chrome,"--remote-debugging-port=9222 --remote-allow-origins=* --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-features=CalculateNativeWinOcclusion --window-size=900,700 --user-data-dir=\""+profile+"\" https://character.ai/"){UseShellExecute=true,WindowStyle=ProcessWindowStyle.Normal};
   var proc=Process.Start(psi);debugChrome=proc;minimizedAfterComposerClick=false;
   try{SetPriorityClass(proc.Handle,ABOVE_NORMAL_PRIORITY_CLASS);SetProcessPriorityBoost(proc.Handle,true);Log("Chrome process priority set to ABOVE NORMAL (VRChat remains foreground).");}catch(Exception px){Log("Chrome priority adjustment: "+px.Message);}
   _=Task.Run(async()=>{for(int n=0;n<20&&!proc.HasExited;n++){try{foreach(var child in Process.GetProcessesByName("chrome")){try{SetPriorityClass(child.Handle,ABOVE_NORMAL_PRIORITY_CLASS);SetProcessPriorityBoost(child.Handle,true);}catch{}}}catch{}await Task.Delay(1500);}});
   // Keep Chrome un-minimized but parked off-screen. SW_SHOWNOACTIVATE avoids taking focus,
   // while an un-minimized browser window allows Character.AI audio to keep playing.
   // Do not call SW_SHOWNOACTIVATE at launch; wait until the chat composer is clicked.
   status.Text="Debug Chrome running off-screen (audio enabled; CDP :9222)";
   Log("Chrome background execution enabled; it will not steal focus or minimize after composer click (VRChat-safe).");
  }catch(Exception ex){Log("Debug Chrome launch failed: "+ex.Message);}
 }
 void Log(string m){if(disposed)return;try{BeginInvoke(new Action(()=>output.AppendText(DateTime.Now.ToString("HH:mm:ss")+" "+m+Environment.NewLine)));}catch{}}
 async Task Serve(){while(!disposed){HttpListenerContext c;try{c=await listener.GetContextAsync();}catch{return;} _=Task.Run(async()=>{
  try{c.Response.Headers["Access-Control-Allow-Origin"]="*";c.Response.Headers["Access-Control-Allow-Methods"]="POST,GET,OPTIONS";c.Response.Headers["Access-Control-Allow-Headers"]="Content-Type";
   if(c.Request.HttpMethod=="OPTIONS"){c.Response.StatusCode=204;c.Response.Close();return;}
   if(c.Request.Url?.AbsolutePath=="/transcript"&&c.Request.HttpMethod=="POST"){using var sr=new StreamReader(c.Request.InputStream);var j=JsonDocument.Parse(await sr.ReadToEndAsync());var phrase=j.RootElement.GetProperty("text").GetString()??"";if(!string.IsNullOrWhiteSpace(phrase)){lastSpeech=DateTime.UtcNow;isIdle=false;waitingReply=true;sawGenerating=false;replyGenerationFinished=false;replyAudioStarted=false;generationPolls=0;lastChromeAudio=DateTime.UtcNow;audioSeen=false;Log("Transcript: "+phrase);if(send.Checked)SendToCai(phrase);}Reply(c,"{\"ok\":true}","application/json");return;}
   if(c.Request.Url?.AbsolutePath=="/"){var path=Path.Combine(AppContext.BaseDirectory,"www","index.html");if(!File.Exists(path))path=Path.Combine(AppContext.BaseDirectory,"index.html");Reply(c,File.ReadAllText(path),"text/html; charset=utf-8");return;}
   c.Response.StatusCode=404;c.Response.Close();
  }catch(Exception ex){Log("HTTP error: "+ex.Message);try{c.Response.Close();}catch{}}
 });}}
 static void Reply(HttpListenerContext c,string text,string type){var b=Encoding.UTF8.GetBytes(text);c.Response.ContentType=type;c.Response.OutputStream.Write(b);c.Response.Close();}
 void SendToCai(string phrase){
  // Avoid a full desktop UI Automation tree scan on every transcript; CDP handles the composer.
  Log("Sending recognized phrase twice as two separate Character.AI messages.");
  _=EnsureVoiceAndSendAsync(phrase);
 }
 bool HasButton(string name){try{return AutomationElement.RootElement.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.NameProperty,name))!=null;}catch{return false;}}
 async Task CheckGenerationGuardedAsync(){try{await Task.Run(()=>{if(!waitingReply||replyGenerationFinished)return;generationPolls++;bool generating=HasButton("Stop generating")||HasButton("Stop response")||HasButton("Stop");if(generating){sawGenerating=true;replyGenerationFinished=false;return;}if(sawGenerating&&generationPolls>=2){replyGenerationFinished=true;Log("c.ai generation finished; Voice remains ON through reply playback.");}});}finally{Interlocked.Exchange(ref monitorBusy,0);}}
 async Task EnsureVoiceAndSendAsync(string phrase){bool locked=false;for(int i=0;i<120;i++){if(Interlocked.CompareExchange(ref voiceBusy,1,0)==0){locked=true;break;}await Task.Delay(100);}if(!locked){Log("Voice recovery stayed busy for 12s; transcript send timed out.");return;}try{Log("Ensuring c.ai Voice is ON (state-aware; no blind double-toggle).");await VoiceToggleAsync(true);_pendingPhrase=phrase;await SendEnterAsync();Log("First message submitted; waiting for c.ai composer to settle before repeat.");await Task.Delay(1200);_pendingPhrase=phrase;await SendEnterAsync();await Task.Delay(250);Log("Second Enter submission dispatched; waiting for c.ai spoken reply.");}catch(Exception ex){Log("Voice pre-send error: "+ex.Message);}finally{Interlocked.Exchange(ref voiceBusy,0);}}
 async Task AudioRecoveryTickAsync(){
  try{
   bool caiPlaying=await CaiMediaIsPlayingAsync();
   float peak=ChromeAudioPeak();
   bool audible=caiPlaying||peak>0.012f;
   if(audible){audioSeen=true;lastChromeAudio=DateTime.UtcNow;replyAudioStarted=true;}
   if(waitingReply&&replyGenerationFinished){
    waitingReply=false;isIdle=true;
    try{BeginInvoke(new Action(()=>status.Text=audible?"IDLE — c.ai audio playing; Voice stays ON":"IDLE — generation finished; Voice stays ON"));}catch{}
    Log("Generation finished; Voice remains ON.");
   }
   // While audio is idle, pulse Voice OFF then ON every 5 seconds.
   // CDP operates on the background tab; it never focuses Chrome or steals VRChat.
   if(audioSeen&&!audible&&!caiPlaying){
    Log("c.ai audio idle: refreshing Voice state (OFF → ON).");
    await VoiceToggleAsync(false);
    await Task.Delay(450);
    await VoiceToggleAsync(true);
    try{BeginInvoke(new Action(()=>status.Text="Voice refreshed — Chrome background / VRChat foreground"));}catch{}
   }
  }catch(Exception ex){Log("Audio recovery: "+ex.Message);}
  finally{Interlocked.Exchange(ref voiceBusy,0);}
 }
 async Task<bool> CaiMediaIsPlayingAsync(){
  try{
   using var targets=JsonDocument.Parse(await cdpHttp.GetStringAsync("http://127.0.0.1:9222/json/list"));
   string ws=null;
   foreach(var t in targets.RootElement.EnumerateArray())
    if(t.TryGetProperty("type",out var typ)&&typ.GetString()=="page"&&t.TryGetProperty("url",out var u)&&u.GetString()?.Contains("character.ai",StringComparison.OrdinalIgnoreCase)==true&&t.TryGetProperty("webSocketDebuggerUrl",out var w)){ws=w.GetString();break;}
   if(ws==null)return false;
   using var socket=new ClientWebSocket();socket.Options.SetRequestHeader("Origin","http://localhost");await socket.ConnectAsync(new Uri(ws),CancellationToken.None);
   string js="(()=>{const a=[...document.querySelectorAll('audio,video')];return a.some(x=>!x.paused&&!x.ended&&x.currentTime>0)})()";
   var payload=JsonSerializer.Serialize(new{id=321,method="Runtime.evaluate",@params=new{expression=js,returnByValue=true}});
   await socket.SendAsync(Encoding.UTF8.GetBytes(payload),WebSocketMessageType.Text,true,CancellationToken.None);
   var buf=new byte[4096];var sb=new StringBuilder();WebSocketReceiveResult rr;
   do{rr=await socket.ReceiveAsync(buf,CancellationToken.None);sb.Append(Encoding.UTF8.GetString(buf,0,rr.Count));}while(!rr.EndOfMessage);
   using var doc=JsonDocument.Parse(sb.ToString());
   bool playing=doc.RootElement.GetProperty("result").GetProperty("result").TryGetProperty("value",out var val)&&val.ValueKind==JsonValueKind.True;
   await socket.CloseAsync(WebSocketCloseStatus.NormalClosure,"done",CancellationToken.None);
   return playing;
  }catch{return false;}
 }
 float ChromeAudioPeak(){try{using var en=new NAudio.CoreAudioApi.MMDeviceEnumerator();using var dev=en.GetDefaultAudioEndpoint(NAudio.CoreAudioApi.DataFlow.Render,NAudio.CoreAudioApi.Role.Multimedia);float peak=0;var sessions=dev.AudioSessionManager.Sessions;for(int i=0;i<sessions.Count;i++){var a=sessions[i];if(Process.GetProcessesByName("chrome").Any(p=>p.Id==a.GetProcessID))peak=Math.Max(peak,a.AudioMeterInformation.MasterPeakValue);}return peak;}catch{return 0;}}
 async Task SendEnterAsync(){
  try{
   await cdpSendLock.WaitAsync();
   try{
    if(sendSocket==null||sendSocket.State!=WebSocketState.Open){
     using var targets=JsonDocument.Parse(await cdpHttp.GetStringAsync("http://127.0.0.1:9222/json/list"));
     string ws=null;
     foreach(var t in targets.RootElement.EnumerateArray())if(t.TryGetProperty("type",out var typ)&&typ.GetString()=="page"&&t.TryGetProperty("url",out var u)&&u.GetString()?.Contains("character.ai",StringComparison.OrdinalIgnoreCase)==true&&t.TryGetProperty("webSocketDebuggerUrl",out var w)){ws=w.GetString();break;}
     if(ws==null){Log("CDP send: no Character.AI tab found.");return;}
     sendSocket=new ClientWebSocket();sendSocket.Options.SetRequestHeader("Origin","http://localhost");await sendSocket.ConnectAsync(new Uri(ws),CancellationToken.None);_=DrainCdpResponsesAsync(sendSocket);
    }
    string js="(()=>{const all=[...document.querySelectorAll('textarea,[contenteditable=true],[role=textbox]')];const e=all.filter(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0&&!x.disabled}).at(-1);if(!e)return 'COMPOSER_NOT_FOUND';const v="+JsonSerializer.Serialize(_pendingPhrase)+";e.focus();if(e.isContentEditable||e.getAttribute('contenteditable')==='true'){e.textContent=v;}else{const p=Object.getPrototypeOf(e),d=Object.getOwnPropertyDescriptor(p,'value');if(d&&d.set)d.set.call(e,v);else e.value=v;}e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:v}));e.dispatchEvent(new Event('change',{bubbles:true}));const f=e.closest('form');if(f){f.requestSubmit();return 'FORM_SUBMITTED';}const b=[...document.querySelectorAll('button')].filter(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0&&!x.disabled&&(x.getAttribute('aria-label')||'').toLowerCase().match(/send|submit/)}).at(-1);if(b){b.click();return 'SEND_BUTTON_CLICKED';}e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));e.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true}));return 'ENTER_EVENTS_DISPATCHED';})()";
    var payload=JsonSerializer.Serialize(new{id=Interlocked.Increment(ref cdpCommandId),method="Runtime.evaluate",@params=new{expression=js,returnByValue=true}});
    await sendSocket.SendAsync(Encoding.UTF8.GetBytes(payload),WebSocketMessageType.Text,true,CancellationToken.None);
    Log("CDP send dispatched over persistent connection.");
   }finally{cdpSendLock.Release();}
  }catch(Exception ex){Log("CDP send error: "+ex.Message);try{sendSocket?.Dispose();}catch{}sendSocket=null;}
 }
 async Task DrainCdpResponsesAsync(ClientWebSocket socket){
  var buffer=new byte[8192];
  try{while(socket.State==WebSocketState.Open){var sb=new StringBuilder();WebSocketReceiveResult r;do{r=await socket.ReceiveAsync(buffer,CancellationToken.None);sb.Append(Encoding.UTF8.GetString(buffer,0,r.Count));}while(!r.EndOfMessage);try{using var d=JsonDocument.Parse(sb.ToString());if(d.RootElement.TryGetProperty("id",out var id)&&d.RootElement.TryGetProperty("result",out var res)&&res.TryGetProperty("result",out var rr)&&rr.TryGetProperty("value",out var v)&&v.ValueKind==JsonValueKind.String){var value=v.GetString();if(value=="COMPOSER_NOT_FOUND")Log("CDP: composer not found.");else Log("c.ai submitted: "+value);}}catch{}}}catch{}
 }
 string _pendingPhrase="";
 async Task WatchComposerFocusAsync(){
  try{
   using var http=new HttpClient{Timeout=TimeSpan.FromSeconds(2)};
   using var targets=JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json/list"));
   string ws=null;
   foreach(var t in targets.RootElement.EnumerateArray())if(t.TryGetProperty("type",out var typ)&&typ.GetString()=="page"&&t.TryGetProperty("url",out var u)&&u.GetString()?.Contains("character.ai",StringComparison.OrdinalIgnoreCase)==true&&t.TryGetProperty("webSocketDebuggerUrl",out var w)){ws=w.GetString();break;}
   if(ws==null)return;
   using var socket=new ClientWebSocket();socket.Options.SetRequestHeader("Origin","http://localhost");await socket.ConnectAsync(new Uri(ws),CancellationToken.None);
   string js="(()=>{const e=document.activeElement;if(!e)return false;return e.matches('textarea,[contenteditable=true],[role=textbox]')})()";
   var payload=JsonSerializer.Serialize(new{id=77,method="Runtime.evaluate",@params=new{expression=js,returnByValue=true}});
   await socket.SendAsync(Encoding.UTF8.GetBytes(payload),WebSocketMessageType.Text,true,CancellationToken.None);
   var buf=new byte[4096];var sb=new StringBuilder();WebSocketReceiveResult rr;do{rr=await socket.ReceiveAsync(buf,CancellationToken.None);sb.Append(Encoding.UTF8.GetString(buf,0,rr.Count));}while(!rr.EndOfMessage);
   using var doc=JsonDocument.Parse(sb.ToString());
   bool focused=doc.RootElement.GetProperty("result").GetProperty("result").TryGetProperty("value",out var val)&&val.ValueKind==JsonValueKind.True;
   await socket.CloseAsync(WebSocketCloseStatus.NormalClosure,"done",CancellationToken.None);
   if(focused&&debugChrome!=null&&!debugChrome.HasExited&&debugChrome.MainWindowHandle!=IntPtr.Zero){minimizedAfterComposerClick=true;ShowWindow(debugChrome.MainWindowHandle,SW_SHOWNOACTIVATE);Log("Chat field focused — Chrome kept running in background without activating or minimizing (VRChat-safe).");}
  }catch{}finally{Interlocked.Exchange(ref composerWatchBusy,0);}
 }
 async Task VoiceToggleAsync(bool ensureOn=false){
  try{
   using var targets=JsonDocument.Parse(await cdpHttp.GetStringAsync("http://127.0.0.1:9222/json/list"));
   string ws=null;
   foreach(var t in targets.RootElement.EnumerateArray()){if(t.TryGetProperty("type",out var typ)&&typ.GetString()=="page"&&t.TryGetProperty("url",out var u)&&u.GetString()?.Contains("character.ai",StringComparison.OrdinalIgnoreCase)==true&&t.TryGetProperty("webSocketDebuggerUrl",out var w)){ws=w.GetString();break;}}
   if(ws==null){Log("CDP: no Character.AI tab found in debug Chrome.");return;}
   using var socket=new ClientWebSocket();socket.Options.SetRequestHeader("Origin","http://localhost");await socket.ConnectAsync(new Uri(ws),CancellationToken.None);
   string js=ensureOn?"(()=>{const bs=[...document.querySelectorAll('button,[role=button]')];const b=bs.find(x=>/voice/i.test((x.getAttribute('aria-label')||'')+' '+(x.getAttribute('title')||'')+' '+(x.innerText||'')))||bs.find(x=>[...x.querySelectorAll('svg path')].some(p=>(p.getAttribute('d')||'').includes('M8 3a1')));if(!b)return 'VOICE_BUTTON_NOT_FOUND';const a=(b.getAttribute('aria-label')||'').toLowerCase(),t=(b.getAttribute('title')||'').toLowerCase(),st=(b.getAttribute('data-state')||'').toLowerCase(),p=b.getAttribute('aria-pressed');const on=p==='true'||st==='on'||st==='active'||/disable|turn off|stop voice/.test(a+' '+t);if(on)return 'VOICE_ALREADY_ON';b.click();return 'VOICE_ENABLED';})()":"(()=>{const bs=[...document.querySelectorAll('button,[role=button]')];const b=bs.find(x=>/voice/i.test((x.getAttribute('aria-label')||'')+' '+(x.getAttribute('title')||'')+' '+(x.innerText||'')))||bs.find(x=>[...x.querySelectorAll('svg path')].some(p=>(p.getAttribute('d')||'').includes('M8 3a1')));if(!b)return 'VOICE_BUTTON_NOT_FOUND';b.click();return 'VOICE_CLICKED';})()";
   var payload=JsonSerializer.Serialize(new{id=1,method="Runtime.evaluate",params_=new{expression=js,returnByValue=true}});
   payload=payload.Replace("params_", "params");
   await socket.SendAsync(Encoding.UTF8.GetBytes(payload),WebSocketMessageType.Text,true,CancellationToken.None);
   var buffer=new byte[8192];var response=new StringBuilder();WebSocketReceiveResult result;
   do{result=await socket.ReceiveAsync(buffer,CancellationToken.None);response.Append(Encoding.UTF8.GetString(buffer,0,result.Count));}while(!result.EndOfMessage);
   using var doc=JsonDocument.Parse(response.ToString());
   string value=doc.RootElement.GetProperty("result").GetProperty("result").TryGetProperty("value",out var v)?v.GetString()??"":"";
   Log(value=="VOICE_CLICKED"?"Character.AI Voice SVG button clicked via CDP.":value=="VOICE_ENABLED"?"Character.AI Voice enabled (state-aware).":value=="VOICE_ALREADY_ON"?"Character.AI Voice already enabled; left ON.":value=="VOICE_SVG_NOT_FOUND"?"Voice SVG signature not found on current c.ai page.":"CDP response: "+value);
   if(value=="VOICE_CLICKED"||value=="VOICE_ENABLED"||value=="VOICE_ALREADY_ON")try{BeginInvoke(new Action(()=>status.Text=ensureOn?"Voice ON — sending transcript":"Voice toggled (CDP)"));}catch{}
   await socket.CloseAsync(WebSocketCloseStatus.NormalClosure,"done",CancellationToken.None);
  }catch(Exception ex){Log("CDP Voice toggle error: "+ex.Message+" (debug Chrome must be running)");}
 }
}
