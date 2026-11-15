using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Diagnostics;
using System.Windows.Forms;

namespace CaiVoiceAutomation;

static class Program {
 [STAThread] static void Main(){ApplicationConfiguration.Initialize(); Application.Run(new MainForm());}
}
public class MainForm:Form {
 TextBox log=new(){Multiline=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill};
 Button start=new(){Text="Start automation",Dock=DockStyle.Top,Height=40};
 Label status=new(){Text="Stopped • Chrome remote debugging :9222",Dock=DockStyle.Top,Height=28};
 CancellationTokenSource? cts; HttpListener? listener; ClientWebSocket? bridge;
 bool voiceOn=false, aiPlaying=false; DateTime lastSpeech=DateTime.MinValue,lastAudio=DateTime.MinValue;
 string? targetWs;
 public MainForm(){Text="CAI Voice Automation";Width=650;Height=420;Controls.Add(log);Controls.Add(status);Controls.Add(start);start.Click+=async(_,__)=>{if(cts!=null){cts.Cancel();return;}cts=new();start.Text="Stop automation";await Run(cts.Token);}; FormClosing+=(_,__)=>cts?.Cancel();}
 void L(string s){if(IsDisposed)return;BeginInvoke(()=>log.AppendText($"[{DateTime.Now:HH:mm:ss}] {s}\r\n"));}
 async Task Run(CancellationToken ct){
 try{
  L("Connecting to Chrome DevTools at 127.0.0.1:9222…");
  using var http=new HttpClient(); var tabs=JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json"));
  targetWs=tabs.RootElement.EnumerateArray().FirstOrDefault(x=>x.GetProperty("url").GetString()?.Contains("character.ai",StringComparison.OrdinalIgnoreCase)==true).GetProperty("webSocketDebuggerUrl").GetString();
  if(string.IsNullOrEmpty(targetWs)){L("Open Character.AI in Chrome debug first.");return;}
  L("Character.AI tab found. Opening localhost speech bridge at http://127.0.0.1:8765");
  listener=new HttpListener();listener.Prefixes.Add("http://127.0.0.1:8765/");listener.Start();
  _=ServeBridge(ct);
  using var cdp=new ClientWebSocket();await cdp.ConnectAsync(new Uri(targetWs),ct);int id=0;
  async Task<string> Eval(string js){var msg=JsonSerializer.Serialize(new{ id=Interlocked.Increment(ref id),method="Runtime.evaluate",@params=new{expression=js,returnByValue=true,awaitPromise=true}});await cdp.SendAsync(Encoding.UTF8.GetBytes(msg),WebSocketMessageType.Text,true,ct);var buf=new byte[65536];while(true){var r=await cdp.ReceiveAsync(buf,ct);var s=Encoding.UTF8.GetString(buf,0,r.Count);using var d=JsonDocument.Parse(s);if(d.RootElement.TryGetProperty("id",out var got)&&got.GetInt32()==id)return d.RootElement.GetProperty("result").GetProperty("result").TryGetProperty("value",out var v)?v.ToString()??"":"";}}
  L("Ready. Voice button toggles on recognized speech; off only after CAI audio ends.");
  while(!ct.IsCancellationRequested){
   // Evaluate media state in the CAI tab. Treat media as playing only while currentTime advances.
   var state=await Eval("(()=>{let a=[...document.querySelectorAll('audio,video')];return JSON.stringify(a.map(x=>({paused:x.paused,ended:x.ended,t:x.currentTime,ready:x.readyState,vol:x.volume})))})()");
   bool playing=false;try{var arr=JsonDocument.Parse(state).RootElement;foreach(var a in arr.EnumerateArray())if(!a.GetProperty("paused").GetBoolean()&&!a.GetProperty("ended").GetBoolean()&&a.GetProperty("ready").GetInt32()>=2)playing=true;}catch{}
   if(playing){aiPlaying=true;lastAudio=DateTime.Now;}
   else if(aiPlaying&&DateTime.Now-lastAudio>TimeSpan.FromSeconds(1.8)){aiPlaying=false;L("CAI audio stopped.");if(voiceOn){await ToggleVoice(Eval);voiceOn=false;L("Voice OFF (audio ended).");}}
   if(DateTime.Now-lastSpeech<TimeSpan.FromSeconds(2)&&!voiceOn){await ToggleVoice(Eval);voiceOn=true;L("Voice ON (speech detected).");}
   await Task.Delay(250,ct);
  }
 }catch(OperationCanceledException){}catch(Exception ex){L("ERROR: "+ex.Message);}finally{listener?.Stop();listener=null;cts=null;start.Text="Start automation";status.Text="Stopped";}
 }
 async Task ToggleVoice(Func<string,Task<string>> eval){
  // Find actual SVG-backed voice button by aria-label/title and common CAI voice control text.
  await eval("(()=>{let b=[...document.querySelectorAll('button')].find(x=>/voice|microphone|call|start voice/i.test((x.getAttribute('aria-label')||'')+' '+(x.getAttribute('title')||'')+' '+(x.innerText||'')));if(!b){b=[...document.querySelectorAll('button')].find(x=>x.querySelector('svg')&&/voice/i.test(x.outerHTML));}if(b)b.click();return !!b})()");
 }
 async Task ServeBridge(CancellationToken ct){
  const string page="<!doctype html><meta charset=utf-8><title>CAI Speech Bridge</title><body>Speech bridge active. Keep this page open.<script>const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){document.body.innerText='Chrome SpeechRecognition unavailable';}else{let r=new SR();r.continuous=true;r.interimResults=false;r.lang='en-US';r.onresult=e=>{let t=e.results[e.results.length-1][0].transcript.trim();if(t)fetch('/speech?text='+encodeURIComponent(t));};r.onerror=e=>{if(e.error!=='no-speech'&&e.error!=='aborted')console.log(e.error);};r.onend=()=>setTimeout(()=>{try{r.start()}catch{}},300);r.start();}</script>";
  while(!ct.IsCancellationRequested&&listener?.IsListening==true){try{var ctx=await listener.GetContextAsync();if(ctx.Request.Url?.AbsolutePath=="/speech"){var t=ctx.Request.QueryString["text"]??"";if(!string.IsNullOrWhiteSpace(t)){lastSpeech=DateTime.Now;L("Recognized: "+t);}}var bytes=Encoding.UTF8.GetBytes(page);ctx.Response.ContentType="text/html";ctx.Response.ContentLength64=bytes.Length;await ctx.Response.OutputStream.WriteAsync(bytes);ctx.Response.Close();}catch{break;}}
 }
}