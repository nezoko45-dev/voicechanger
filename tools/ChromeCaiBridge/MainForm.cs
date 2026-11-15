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
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 const int SW_SHOWNOACTIVATE=4, SW_MINIMIZE=6;
 Process debugChrome; bool minimizedAfterComposerClick; int composerWatchBusy;
 readonly HttpListener listener=new();
 readonly TextBox output=new(){Multiline=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill};
 readonly CheckBox send=new(){Text="Send recognized final phrases to c.ai",Checked=true,AutoSize=true};
 readonly CheckBox keepalive=new(){Text="Toggle Voice every 5 seconds while IDLE",Checked=true,AutoSize=true};
 readonly Label status=new(){AutoSize=true,Text="Starting…"};
 readonly string profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ChromeCaiBridge","DebugProfile");
 DateTime lastSpeech=DateTime.UtcNow; bool disposed,waitingReply,sawGenerating,isIdle=true; int generationPolls; int monitorBusy,voiceBusy;
 const string SvgPathPrefix="M8 3a1 1 0 0 1 1 1v7.105l2-1.473";
 public MainForm(){
  Text="Chrome c.ai Voice Bridge (Debug Chrome)";Width=820;Height=540;
  var bar=new FlowLayoutPanel{Dock=DockStyle.Top,Height=105};
  var launch=new Button{Text="Launch debug Chrome + c.ai",AutoSize=true};launch.Click+=(s,e)=>LaunchDebugChrome();
  var open=new Button{Text="Open Chrome recognition",AutoSize=true};open.Click+=(s,e)=>Process.Start(new ProcessStartInfo("http://127.0.0.1:8765/"){UseShellExecute=true});
  bar.Controls.Add(launch);bar.Controls.Add(open);bar.Controls.Add(send);bar.Controls.Add(keepalive);bar.Controls.Add(status);Controls.Add(output);Controls.Add(bar);
  Shown+=(s,e)=>{try{listener.Prefixes.Add("http://127.0.0.1:8765/");listener.Start();status.Text="Speech bridge ready";_=Serve();}catch(Exception ex){Log("Listener failed: "+ex.Message);} LaunchDebugChrome();};
  var timer=new System.Windows.Forms.Timer{Interval=5000};timer.Tick+=(s,e)=>{if(keepalive.Checked&&isIdle&&Interlocked.Exchange(ref voiceBusy,1)==0)_=VoiceToggleGuardedAsync();};timer.Start();
  var composerWatch=new System.Windows.Forms.Timer{Interval=700};composerWatch.Tick+=(s,e)=>{if(!minimizedAfterComposerClick&&debugChrome!=null&&Interlocked.Exchange(ref composerWatchBusy,1)==0)_=WatchComposerFocusAsync();};composerWatch.Start();
  var monitor=new System.Windows.Forms.Timer{Interval=1500};monitor.Tick+=(s,e)=>{if(waitingReply&&Interlocked.Exchange(ref monitorBusy,1)==0)_=CheckGenerationGuardedAsync();};monitor.Start();
  FormClosing+=(s,e)=>{disposed=true;try{listener.Stop();}catch{}};
 }
 void LaunchDebugChrome(){
  try{
   Directory.CreateDirectory(profile);
   string[] paths={Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google","Chrome","Application","chrome.exe")};
   string chrome=Array.Find(paths,File.Exists);
   if(chrome==null){Log("Chrome executable not found. Install Google Chrome.");return;}
   var psi=new ProcessStartInfo(chrome,"--remote-debugging-port=9222 --remote-allow-origins=* --window-position=-32000,-32000 --window-size=900,700 --user-data-dir=\""+profile+"\" https://character.ai/"){UseShellExecute=true,WindowStyle=ProcessWindowStyle.Normal};
   var proc=Process.Start(psi);debugChrome=proc;minimizedAfterComposerClick=false;
   // Keep Chrome un-minimized but parked off-screen. SW_SHOWNOACTIVATE avoids taking focus,
   // while an un-minimized browser window allows Character.AI audio to keep playing.
   Task.Run(async()=>{await Task.Delay(1200);try{if(proc!=null&&!proc.HasExited&&proc.MainWindowHandle!=IntPtr.Zero)ShowWindow(proc.MainWindowHandle,SW_SHOWNOACTIVATE);}catch{}});
   status.Text="Debug Chrome running off-screen (audio enabled; CDP :9222)";
   Log("Chrome window parked off-screen; it will minimize automatically after you click the c.ai chat field.");
  }catch(Exception ex){Log("Debug Chrome launch failed: "+ex.Message);}
 }
 void Log(string m){if(disposed)return;try{BeginInvoke(new Action(()=>output.AppendText(DateTime.Now.ToString("HH:mm:ss")+" "+m+Environment.NewLine)));}catch{}}
 async Task Serve(){while(!disposed){HttpListenerContext c;try{c=await listener.GetContextAsync();}catch{return;} _=Task.Run(async()=>{
  try{c.Response.Headers["Access-Control-Allow-Origin"]="*";c.Response.Headers["Access-Control-Allow-Methods"]="POST,GET,OPTIONS";c.Response.Headers["Access-Control-Allow-Headers"]="Content-Type";
   if(c.Request.HttpMethod=="OPTIONS"){c.Response.StatusCode=204;c.Response.Close();return;}
   if(c.Request.Url?.AbsolutePath=="/transcript"&&c.Request.HttpMethod=="POST"){using var sr=new StreamReader(c.Request.InputStream);var j=JsonDocument.Parse(await sr.ReadToEndAsync());var phrase=j.RootElement.GetProperty("text").GetString()??"";if(!string.IsNullOrWhiteSpace(phrase)){lastSpeech=DateTime.UtcNow;isIdle=false;waitingReply=true;sawGenerating=false;generationPolls=0;Log("Transcript: "+phrase);if(send.Checked)SendToCai(phrase);}Reply(c,"{\"ok\":true}","application/json");return;}
   if(c.Request.Url?.AbsolutePath=="/"){var path=Path.Combine(AppContext.BaseDirectory,"www","index.html");if(!File.Exists(path))path=Path.Combine(AppContext.BaseDirectory,"index.html");Reply(c,File.ReadAllText(path),"text/html; charset=utf-8");return;}
   c.Response.StatusCode=404;c.Response.Close();
  }catch(Exception ex){Log("HTTP error: "+ex.Message);try{c.Response.Close();}catch{}}
 });}}
 static void Reply(HttpListenerContext c,string text,string type){var b=Encoding.UTF8.GetBytes(text);c.Response.ContentType=type;c.Response.OutputStream.Write(b);c.Response.Close();}
 void SendToCai(string phrase){try{
  var root=AutomationElement.RootElement;
  var edits=root.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit));
  AutomationElement composer=null;
  for(int i=0;i<edits.Count;i++){var candidate=edits[i];string name="";try{name=candidate.Current.Name??"";}catch{}if(name.Contains("message",StringComparison.OrdinalIgnoreCase)||name.Contains("chat",StringComparison.OrdinalIgnoreCase)||name.Contains("reply",StringComparison.OrdinalIgnoreCase)){composer=candidate;break;}}
  if(composer==null&&edits.Count>0)composer=edits[edits.Count-1];
  if(composer==null){Log("Background c.ai composer not exposed by UI Automation.");waitingReply=false;isIdle=true;return;}
  if(!composer.TryGetCurrentPattern(ValuePattern.Pattern,out var vp)){Log("c.ai composer lacks background ValuePattern.");waitingReply=false;isIdle=true;return;}
  ((ValuePattern)vp).SetValue(phrase);
  Log("Transcript pasted into c.ai composer; sending Enter via Chrome CDP.");
  _=SendEnterAsync();
  Log("Enter dispatched; waiting for Character.AI reply…");
 }catch(Exception ex){Log("Background UIA send error: "+ex.Message);waitingReply=false;isIdle=true;}}
 bool HasButton(string name){try{return AutomationElement.RootElement.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.NameProperty,name))!=null;}catch{return false;}}
 async Task CheckGenerationGuardedAsync(){try{await Task.Run(()=>{if(!waitingReply)return;generationPolls++;bool generating=HasButton("Stop generating")||HasButton("Stop response")||HasButton("Stop");if(generating){sawGenerating=true;return;}if((sawGenerating&&generationPolls>=2)||generationPolls>=120){waitingReply=false;isIdle=true;try{BeginInvoke(new Action(()=>status.Text="IDLE — reply complete"));}catch{}Log("c.ai reply finished; bridge returned to IDLE.");}});}finally{Interlocked.Exchange(ref monitorBusy,0);}}
 async Task VoiceToggleGuardedAsync(){try{await VoiceToggleAsync();}finally{Interlocked.Exchange(ref voiceBusy,0);}}
 async Task SendEnterAsync(){
  try{
   using var http=new HttpClient{Timeout=TimeSpan.FromSeconds(8)};
   using var targets=JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json/list"));
   string ws=null;
   foreach(var t in targets.RootElement.EnumerateArray()){if(t.TryGetProperty("type",out var typ)&&typ.GetString()=="page"&&t.TryGetProperty("url",out var u)&&u.GetString()?.Contains("character.ai",StringComparison.OrdinalIgnoreCase)==true&&t.TryGetProperty("webSocketDebuggerUrl",out var w)){ws=w.GetString();break;}}
   if(ws==null){Log("CDP send: no Character.AI tab found.");return;}
   using var socket=new ClientWebSocket();socket.Options.SetRequestHeader("Origin","http://localhost");await socket.ConnectAsync(new Uri(ws),CancellationToken.None);
   // Locate the actual chat composer, update React's value, then submit its form.
   string js="(()=>{const all=[...document.querySelectorAll('textarea,[contenteditable=true],[role=textbox]')];const e=all.filter(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0&&!x.disabled}).at(-1);if(!e)return 'COMPOSER_NOT_FOUND';e.focus();const v="+JsonSerializer.Serialize(_pendingPhrase)+";if(e.isContentEditable||e.getAttribute('contenteditable')==='true'){e.textContent=v;}else{const p=Object.getPrototypeOf(e),d=Object.getOwnPropertyDescriptor(p,'value');if(d&&d.set)d.set.call(e,v);else e.value=v;}e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:v}));e.dispatchEvent(new Event('change',{bubbles:true}));const f=e.closest('form');if(f){f.requestSubmit();return 'FORM_SUBMITTED';}const b=[...document.querySelectorAll('button')].filter(x=>{const r=x.getBoundingClientRect();return r.width>0&&r.height>0&&!x.disabled&&(x.getAttribute('aria-label')||'').toLowerCase().match(/send|submit/)}).at(-1);if(b){b.click();return 'SEND_BUTTON_CLICKED';}e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));e.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true}));return 'ENTER_EVENTS_DISPATCHED';})()";
   // phrase is passed as a JS string literal safely.
   var eval=JsonSerializer.Serialize(new{id=31,method="Runtime.evaluate",@params=new{expression=js,returnByValue=true}});
   await socket.SendAsync(Encoding.UTF8.GetBytes(eval),WebSocketMessageType.Text,true,CancellationToken.None);
   var buffer=new byte[8192];var response=new StringBuilder();WebSocketReceiveResult result;
   do{result=await socket.ReceiveAsync(buffer,CancellationToken.None);response.Append(Encoding.UTF8.GetString(buffer,0,result.Count));}while(!result.EndOfMessage);
   using(var doc=JsonDocument.Parse(response.ToString())){
    string value=doc.RootElement.GetProperty("result").GetProperty("result").TryGetProperty("value",out var v)?v.GetString()??"":"";
    Log("Character.AI submit result: "+value);
    if(value=="COMPOSER_NOT_FOUND")Log("Send failed: no visible c.ai composer found.");
   }
   await socket.CloseAsync(WebSocketCloseStatus.NormalClosure,"done",CancellationToken.None);
  }catch(Exception ex){Log("CDP send error: "+ex.Message);}
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
   if(focused&&debugChrome!=null&&!debugChrome.HasExited&&debugChrome.MainWindowHandle!=IntPtr.Zero){minimizedAfterComposerClick=true;ShowWindow(debugChrome.MainWindowHandle,SW_MINIMIZE);Log("Chat field focused — Chrome minimized automatically.");}
  }catch{}finally{Interlocked.Exchange(ref composerWatchBusy,0);}
 }
 async Task VoiceToggleAsync(){
  try{
   using var http=new HttpClient{Timeout=TimeSpan.FromSeconds(3)};
   var targets=JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json/list"));
   string ws=null;
   foreach(var t in targets.RootElement.EnumerateArray()){if(t.TryGetProperty("type",out var typ)&&typ.GetString()=="page"&&t.TryGetProperty("url",out var u)&&u.GetString()?.Contains("character.ai",StringComparison.OrdinalIgnoreCase)==true&&t.TryGetProperty("webSocketDebuggerUrl",out var w)){ws=w.GetString();break;}}
   if(ws==null){Log("CDP: no Character.AI tab found in debug Chrome.");return;}
   using var socket=new ClientWebSocket();socket.Options.SetRequestHeader("Origin","http://localhost");await socket.ConnectAsync(new Uri(ws),CancellationToken.None);
   string js="(()=>{const s=[...document.querySelectorAll('svg')].find(x=>[...x.querySelectorAll('path')].some(p=>(p.getAttribute('d')||'').startsWith('"+SvgPathPrefix+"')));const b=s?.closest('button,[role=button]');if(!b)return 'VOICE_SVG_NOT_FOUND';b.click();return 'VOICE_CLICKED';})()";
   var payload=JsonSerializer.Serialize(new{id=1,method="Runtime.evaluate",params_=new{expression=js,returnByValue=true}});
   payload=payload.Replace("params_", "params");
   await socket.SendAsync(Encoding.UTF8.GetBytes(payload),WebSocketMessageType.Text,true,CancellationToken.None);
   var buffer=new byte[8192];var response=new StringBuilder();WebSocketReceiveResult result;
   do{result=await socket.ReceiveAsync(buffer,CancellationToken.None);response.Append(Encoding.UTF8.GetString(buffer,0,result.Count));}while(!result.EndOfMessage);
   using var doc=JsonDocument.Parse(response.ToString());
   string value=doc.RootElement.GetProperty("result").GetProperty("result").TryGetProperty("value",out var v)?v.GetString()??"":"";
   Log(value=="VOICE_CLICKED"?"Character.AI Voice SVG button clicked via CDP.":value=="VOICE_SVG_NOT_FOUND"?"Voice SVG signature not found on current c.ai page.":"CDP response: "+value);
   if(value=="VOICE_CLICKED")try{BeginInvoke(new Action(()=>status.Text="Voice toggled (CDP)"));}catch{}
   await socket.CloseAsync(WebSocketCloseStatus.NormalClosure,"done",CancellationToken.None);
  }catch(Exception ex){Log("CDP Voice toggle error: "+ex.Message+" (debug Chrome must be running)");}
 }
}
