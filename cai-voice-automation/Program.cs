using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Diagnostics;
using System.Windows.Forms;
using NAudio.Wave;
using Whisper.net;

namespace CaiVoiceAutomation;
static class Program { [STAThread] static void Main(){ApplicationConfiguration.Initialize();Application.Run(new MainForm());} }

public class MainForm:Form {
 TextBox log=new(){Multiline=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill};
 Button start=new(){Text="Start",Dock=DockStyle.Top,Height=42};
 Label status=new(){Text="STOPPED",Dock=DockStyle.Top,Height=30};
 CancellationTokenSource? cts; bool voiceOn=false,aiPlaying=false;
 DateTime lastSpeech=DateTime.MinValue,lastAudio=DateTime.MinValue; string? ws; ClientWebSocket? cdp; int cdpId=0;
 readonly SemaphoreSlim cdpLock=new(1,1);
 WhisperFactory? whisperFactory; WhisperProcessor? whisperProcessor; WaveInEvent? mic;
 readonly object audioLock=new(); List<float> utterance=new(); bool speechSeen=false; int quietSamples=0;
 const int SampleRate=16000; const int SilenceSamples=12000; // 750ms
  public MainForm(){Text="CAI Voice Automation • Offline Whisper";Width=700;Height=480;Controls.Add(log);Controls.Add(status);Controls.Add(start);start.Click+=async(_,__)=>{if(cts!=null){cts.Cancel();return;}cts=new();start.Text="Stop";await Run(cts.Token);};FormClosing+=(_,__)=>cts?.Cancel();}
 void L(string s){if(IsDisposed)return;BeginInvoke(()=>log.AppendText($"[{DateTime.Now:HH:mm:ss}] {s}\r\n"));}
 async Task Run(CancellationToken ct){
 try{
  string model=Path.Combine(AppContext.BaseDirectory,"model","ggml-small.en.bin");
  if(!File.Exists(model))throw new Exception("Whisper model missing: "+model+" (extract the complete ZIP, including model folder).");
  L("Loading Whisper small.en locally…");whisperFactory=WhisperFactory.FromPath(model);whisperProcessor=whisperFactory.CreateBuilder().WithLanguage("en").Build();L("Whisper model loaded (offline).");
  StartMic();_=Task.Run(()=>TranscriptionLoop(ct),ct);
  using var http=new HttpClient();bool debugReady=false;try{using var probe=await http.GetAsync("http://127.0.0.1:9222/json/version",ct);debugReady=probe.IsSuccessStatusCode;}catch{}
  if(!debugReady){string chrome=FindChrome();if(chrome==null)throw new Exception("Chrome executable not found.");
   string profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CAIVoiceAutomation","ChromeDebugProfile");Directory.CreateDirectory(profile);
   Process.Start(new ProcessStartInfo(chrome){UseShellExecute=false,Arguments="--remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="+Quote(profile)+" --no-first-run --new-window https://character.ai"});
   L("Launched Chrome DEBUG on port 9222.");for(int i=0;i<30&&!ct.IsCancellationRequested;i++){try{using var p=await http.GetAsync("http://127.0.0.1:9222/json/version",ct);if(p.IsSuccessStatusCode){debugReady=true;break;}}catch{}await Task.Delay(500,ct);}
  }else L("Found Chrome DevTools :9222.");
  if(!debugReady)throw new Exception("Chrome Debug did not start on port 9222.");
  async Task<JsonDocument> GetTargets()=>JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json",ct));
  async Task<bool> HasTab(string needle){using var tabs=await GetTargets();return tabs.RootElement.EnumerateArray().Any(x=>((x.TryGetProperty("url",out var u)?u.GetString():"")??"").Contains(needle,StringComparison.OrdinalIgnoreCase));}
  async Task OpenDebugTab(string url){using var resp=await http.PutAsync("http://127.0.0.1:9222/json/new?"+Uri.EscapeDataString(url),new StringContent(""),ct);if(!resp.IsSuccessStatusCode)L("Chrome tab create returned "+(int)resp.StatusCode);}
  if(!await HasTab("character.ai"))await OpenDebugTab("https://character.ai/");
  for(int k=0;k<12&&!await HasTab("character.ai");k++)await Task.Delay(500,ct);
  status.Text="RUNNING • WHISPER OFFLINE • Chrome DEBUG :9222";L("Mic capture active; Whisper recognizes locally; CDP sends into CAI.");

  async Task<bool> Connect(){try{using var tabs=JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json"));JsonElement tab=default;
   foreach(var x in tabs.RootElement.EnumerateArray()){var u=x.TryGetProperty("url",out var uv)?uv.GetString():"";if(u!=null&&u.Contains("character.ai",StringComparison.OrdinalIgnoreCase)){tab=x;break;}}
   if(tab.ValueKind==JsonValueKind.Undefined){L("CDP: no CAI tab; retry");return false;}
   cdp=new ClientWebSocket();await cdp.ConnectAsync(new Uri(tab.GetProperty("webSocketDebuggerUrl").GetString()!),ct);await CdpEval("location.href");L("CDP attached: "+tab.GetProperty("url").GetString());return true;
  }catch(Exception e){L("CDP connect: "+e.Message);return false;}}
  while(!ct.IsCancellationRequested){if(cdp==null||cdp.State!=WebSocketState.Open){await Connect();await Task.Delay(1500,ct);continue;}
   try{string state=await CdpEval("JSON.stringify([...document.querySelectorAll('audio,video')].map(a=>({p:a.paused,e:a.ended,r:a.readyState})))");bool playing=false;
    try{foreach(var a in JsonDocument.Parse(state).RootElement.EnumerateArray())if(!a.GetProperty("p").GetBoolean()&&!a.GetProperty("e").GetBoolean()&&a.GetProperty("r").GetInt32()>=2)playing=true;}catch{}
    if(playing){aiPlaying=true;lastAudio=DateTime.Now;}else if(aiPlaying&&DateTime.Now-lastAudio>TimeSpan.FromSeconds(2)){aiPlaying=false;L("CAI audio ended.");if(voiceOn){await ToggleVoice();voiceOn=false;}}
    if(DateTime.Now-lastSpeech<TimeSpan.FromSeconds(2)&&!voiceOn){await ToggleVoice();voiceOn=true;}
   }catch(Exception ex){L("CDP issue: "+ex.Message);try{cdp.Abort();cdp.Dispose();}catch{}cdp=null;}await Task.Delay(300,ct);}
 }catch(OperationCanceledException){}catch(Exception ex){L("ERROR: "+ex.Message);}finally{StopMic();try{cdp?.Abort();cdp?.Dispose();}catch{}cdp=null;whisperProcessor?.Dispose();whisperProcessor=null;whisperFactory?.Dispose();whisperFactory=null;cts=null;start.Text="Start";status.Text="STOPPED";L("Stopped.");}}
 void StartMic(){mic=new WaveInEvent{WaveFormat=new WaveFormat(SampleRate,16,1),BufferMilliseconds=50};mic.DataAvailable+=MicData;mic.StartRecording();L("Default Windows microphone started (16kHz mono).");}
 void StopMic(){try{if(mic!=null){mic.StopRecording();mic.Dispose();mic=null;}}catch{}}
 void MicData(object? sender,WaveInEventArgs e){lock(audioLock){for(int i=0;i+1<e.BytesRecorded;i+=2){short s=BitConverter.ToInt16(e.Buffer,i);float v=s/32768f;utterance.Add(v);if(Math.Abs(v)>0.012f){speechSeen=true;quietSamples=0;}else quietSamples++;
   if(speechSeen&&quietSamples>=SilenceSamples&&utterance.Count>=SampleRate/2){var chunk=utterance.ToArray();pending.Enqueue(chunk);utterance.Clear();speechSeen=false;quietSamples=0;}
   if(utterance.Count>SampleRate*18){utterance.Clear();speechSeen=false;quietSamples=0;}}}}
 readonly System.Collections.Concurrent.ConcurrentQueue<float[]> pending=new();
 async Task TranscriptionLoop(CancellationToken ct){while(!ct.IsCancellationRequested){if(!pending.TryDequeue(out var audio)){await Task.Delay(80,ct);continue;}try{
   // Reject near-silent chunks before invoking Whisper; this prevents hallucinations during silence.
   double rms=Math.Sqrt(audio.Select(x=>(double)x*x).Average());if(rms<0.008){L("Whisper skipped quiet audio.");continue;}
   L("Whisper transcribing "+(audio.Length/(double)SampleRate).ToString("0.0")+"s…");var sb=new StringBuilder();
   await foreach(var seg in whisperProcessor!.ProcessAsync(audio,ct)){if(!string.IsNullOrWhiteSpace(seg.Text))sb.Append(seg.Text);}
   string text=sb.ToString().Trim();text=System.Text.RegularExpressions.Regex.Replace(text,@"\s+"," ");
   if(text.Length<2||text.All(char.IsPunctuation)){L("Whisper returned no speech; ignored.");continue;}
   L("Whisper: "+text);await Deliver(text,ct);
  }catch(OperationCanceledException){break;}catch(Exception ex){L("Whisper error: "+ex.Message);}}}
 async Task Deliver(string t,CancellationToken ct){lastSpeech=DateTime.Now;var encoded=JsonSerializer.Serialize(t);var result=await CdpEval("(()=>{let t="+encoded+";let e=document.querySelector('textarea')||document.querySelector('[contenteditable=true]')||document.querySelector('[role=textbox]');if(!e)return 'CHAT INPUT NOT FOUND';e.focus();if(e.tagName==='TEXTAREA'||e.tagName==='INPUT'){let p=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;p.call(e,t);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t}));}else{document.execCommand('insertText',false,t);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t}));}return 'TRANSCRIPT INSERTED'})()");
  L("CAI insertion: "+result);if(result.Contains("TRANSCRIPT INSERTED")){await CdpKey("Enter");L("Enter sent to CAI.");}}
 string? FindChrome(){string[] paths={Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google","Chrome","Application","chrome.exe")};return paths.FirstOrDefault(File.Exists);}
 string Quote(string s)=>"\""+s.Replace("\"","\\\"")+"\"";
 async Task<string> CdpEval(string js){await cdpLock.WaitAsync();try{if(cdp==null||cdp.State!=WebSocketState.Open)return "";int id=Interlocked.Increment(ref cdpId);var msg=JsonSerializer.Serialize(new{id,method="Runtime.evaluate",@params=new{expression=js,returnByValue=true,awaitPromise=true}});await cdp.SendAsync(Encoding.UTF8.GetBytes(msg),WebSocketMessageType.Text,true,CancellationToken.None);var buf=new byte[65536];while(true){var r=await cdp.ReceiveAsync(buf,CancellationToken.None);using var d=JsonDocument.Parse(Encoding.UTF8.GetString(buf,0,r.Count));if(d.RootElement.TryGetProperty("id",out var got)&&got.GetInt32()==id){var rr=d.RootElement.GetProperty("result");if(rr.TryGetProperty("result",out var val)&&val.TryGetProperty("value",out var v))return v.ToString()??"";if(rr.TryGetProperty("exceptionDetails",out var er))return "JS_ERROR "+er;return "";}}}finally{cdpLock.Release();}}
 async Task CdpKey(string key){await cdpLock.WaitAsync();try{if(cdp==null||cdp.State!=WebSocketState.Open)return;async Task Send(string type){int id=Interlocked.Increment(ref cdpId);var msg=JsonSerializer.Serialize(new{id,method="Input.dispatchKeyEvent",@params=new{type,key,code=key,windowsVirtualKeyCode=key=="Enter"?13:0,nativeVirtualKeyCode=key=="Enter"?13:0}});await cdp.SendAsync(Encoding.UTF8.GetBytes(msg),WebSocketMessageType.Text,true,CancellationToken.None);var buf=new byte[65536];while(true){var rr=await cdp.ReceiveAsync(buf,CancellationToken.None);using var d=JsonDocument.Parse(Encoding.UTF8.GetString(buf,0,rr.Count));if(d.RootElement.TryGetProperty("id",out var got)&&got.GetInt32()==id)break;}}await Send("keyDown");await Send("keyUp");}finally{cdpLock.Release();}}
 async Task ToggleVoice(){var x=await CdpEval("(()=>{let b=[...document.querySelectorAll('button,[role=button]')].find(x=>/voice|microphone|start voice|stop voice/i.test((x.getAttribute('aria-label')||'')+' '+(x.getAttribute('title')||'')+' '+(x.innerText||'')));if(!b)b=[...document.querySelectorAll('button,[role=button]')].find(x=>x.querySelector('svg')&&/voice|mic|audio/i.test(x.outerHTML));if(b){b.click();return 'CLICKED '+(b.getAttribute('aria-label')||b.title||b.innerText)}return 'VOICE BUTTON NOT FOUND'})()");L("Voice toggle: "+x);}
}