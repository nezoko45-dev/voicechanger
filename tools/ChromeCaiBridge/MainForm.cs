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
using System.Windows.Automation;

namespace ChromeCaiBridge;
public sealed class MainForm : Form {
 readonly HttpListener listener=new();
 readonly TextBox output=new(){Multiline=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill};
 readonly CheckBox send=new(){Text="Send recognized final phrases to c.ai",Checked=true,AutoSize=true};
 readonly CheckBox keepalive=new(){Text="Toggle Voice every 5 seconds while IDLE",Checked=true,AutoSize=true};
 readonly Label status=new(){AutoSize=true,Text="Starting…"};
 readonly string profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ChromeCaiBridge","DebugProfile");
 DateTime lastSpeech=DateTime.UtcNow; bool disposed,waitingReply,sawGenerating,isIdle=true; int generationPolls;
 const string SvgPathPrefix="M8 3a1 1 0 0 1 1 1v7.105l2-1.473";
 public MainForm(){
  Text="Chrome c.ai Voice Bridge (Debug Chrome)";Width=820;Height=540;
  var bar=new FlowLayoutPanel{Dock=DockStyle.Top,Height=105};
  var launch=new Button{Text="Launch debug Chrome + c.ai",AutoSize=true};launch.Click+=(s,e)=>LaunchDebugChrome();
  var open=new Button{Text="Open Chrome recognition",AutoSize=true};open.Click+=(s,e)=>Process.Start(new ProcessStartInfo("http://127.0.0.1:8765/"){UseShellExecute=true});
  bar.Controls.Add(launch);bar.Controls.Add(open);bar.Controls.Add(send);bar.Controls.Add(keepalive);bar.Controls.Add(status);Controls.Add(output);Controls.Add(bar);
  Shown+=(s,e)=>{try{listener.Prefixes.Add("http://127.0.0.1:8765/");listener.Start();status.Text="Speech bridge ready";_=Serve();}catch(Exception ex){Log("Listener failed: "+ex.Message);} LaunchDebugChrome();};
  var timer=new System.Windows.Forms.Timer{Interval=5000};timer.Tick+=(s,e)=>{if(keepalive.Checked&&isIdle)_=VoiceToggleAsync();};timer.Start();
  var monitor=new System.Windows.Forms.Timer{Interval=1000};monitor.Tick+=(s,e)=>CheckGeneration();monitor.Start();
  FormClosing+=(s,e)=>{disposed=true;try{listener.Stop();}catch{}};
 }
 void LaunchDebugChrome(){
  try{
   Directory.CreateDirectory(profile);
   string[] paths={Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google","Chrome","Application","chrome.exe")};
   string chrome=Array.Find(paths,File.Exists);
   if(chrome==null){Log("Chrome executable not found. Install Google Chrome.");return;}
   Process.Start(new ProcessStartInfo(chrome,"--remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=\""+profile+"\" https://character.ai/"){UseShellExecute=false});
   status.Text="Debug Chrome launched (CDP :9222)";
   Log("Launched debug Chrome profile. Sign into Character.AI in that window once.");
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
  var sendButton=root.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button),new PropertyCondition(AutomationElement.NameProperty,"Send")));
  if(sendButton!=null&&sendButton.TryGetCurrentPattern(InvokePattern.Pattern,out var sp))((InvokePattern)sp).Invoke();else Log("Text inserted, but Send UIA button was not found.");
  Log("Background c.ai message submitted; waiting for generation…");
 }catch(Exception ex){Log("Background UIA send error: "+ex.Message);waitingReply=false;isIdle=true;}}
 bool HasButton(string name){try{return AutomationElement.RootElement.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.NameProperty,name))!=null;}catch{return false;}}
 void CheckGeneration(){
  if(!waitingReply)return;generationPolls++;
  bool generating=HasButton("Stop generating")||HasButton("Stop response")||HasButton("Stop");
  bool finishedSignal=HasButton("Regenerate")||HasButton("Try again");
  if(generating){sawGenerating=true;return;}
  if((sawGenerating&&generationPolls>=2)||finishedSignal||generationPolls>=90){waitingReply=false;isIdle=true;status.Text="IDLE — reply complete";Log("c.ai finished generating; bridge is IDLE.");}
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
   if(value=="VOICE_CLICKED")status.Text="Voice toggled (CDP)";
   await socket.CloseAsync(WebSocketCloseStatus.NormalClosure,"done",CancellationToken.None);
  }catch(Exception ex){Log("CDP Voice toggle error: "+ex.Message+" (debug Chrome must be running)");}
 }
}
