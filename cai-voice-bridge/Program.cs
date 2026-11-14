using System.Diagnostics;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

const int DebugPort=9222, LocalPort=8765;
const string Page = """
<!doctype html><html><meta charset="utf-8"><title>CAI Chrome Speech Bridge</title>
<style>body{font:16px system-ui;background:#17171b;color:#eee;max-width:720px;margin:35px auto;padding:20px}button{font-size:17px;padding:12px 18px;cursor:pointer}#status{padding:12px 0;color:#9f9}textarea{box-sizing:border-box;width:100%;height:170px;background:#24242a;color:#eee;padding:12px;border:0;border-radius:8px;font:16px system-ui}</style>
<h2>Character.AI · Chrome Speech Recognition</h2><button id="toggle">Start Chrome Recognition</button><div id="status">Ready. Click Start and allow microphone access.</div><h3>Recognized words</h3><textarea id="heard" placeholder="Your recognized words will appear here…" readonly></textarea>
<script>
const btn=document.querySelector('#toggle'),status=document.querySelector('#status'),heard=document.querySelector('#heard');
let rec=null,active=false,restarting=false;
function say(s){status.textContent=s}
function add(s){heard.value+=(heard.value?'\n':'')+s;heard.scrollTop=heard.scrollHeight}
function post(path,data=''){return fetch(path,{method:'POST',body:data})}
function start(){
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR){say('ERROR: This Chrome build does not expose SpeechRecognition.');return}
 rec=new SR();rec.lang='en-US';rec.continuous=true;rec.interimResults=false;rec.maxAlternatives=1;
 rec.onstart=()=>say('Chrome is listening. Speak naturally.');
 rec.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++){if(!e.results[i].isFinal)continue;const words=e.results[i][0].transcript.trim();if(!words)continue;add(words);say('Recognized: '+words+' · sending to Character.AI…');post('/speech',words).then(()=>say('Sent: '+words+' · listening')).catch(x=>say('Send error: '+x.message));}};
 rec.onerror=e=>{say('Chrome Speech error: '+e.error+(e.error==='network'?' — Chrome speech service needs internet access.':''));if(e.error==='not-allowed'||e.error==='service-not-allowed'){active=false;btn.textContent='Start Chrome Recognition'}};
 rec.onend=()=>{if(active){say('Recognition paused; restarting Chrome speech…');setTimeout(()=>{if(active)try{rec.start()}catch{}},700)}else say('Recognition stopped.')};
 active=true;btn.textContent='Stop Recognition';try{rec.start()}catch(e){say('Start failed: '+e.message);active=false;btn.textContent='Start Chrome Recognition'}
}
btn.onclick=()=>{if(active){active=false;try{rec.stop()}catch{}btn.textContent='Start Chrome Recognition'}else start()};
</script></html>
""";
Console.Title="CAI Chrome Speech Bridge";
Console.WriteLine("CAI Chrome Speech Bridge (Chrome Web Speech API)");
using var http=new HttpClient{Timeout=TimeSpan.FromSeconds(4)};
var state=new BridgeState();ClientWebSocket? monitor=null;JsonElement target=default;int id=0;
_ = Server();
EnsureBrowser();
OpenSpeechPage();
while(true){
 try{
  using var res=await http.GetAsync("http://127.0.0.1:9222/json");res.EnsureSuccessStatusCode();
  using var doc=JsonDocument.Parse(await res.Content.ReadAsStringAsync());
  var t=doc.RootElement.EnumerateArray().FirstOrDefault(x=>x.TryGetProperty("type",out var ty)&&ty.GetString()=="page"&&x.TryGetProperty("url",out var u)&&u.GetString()!.Contains("character.ai",StringComparison.OrdinalIgnoreCase));
  if(t.ValueKind==JsonValueKind.Undefined){await Task.Delay(1200);continue;}
  if(monitor?.State==WebSocketState.Open&&target.GetProperty("id").GetString()==t.GetProperty("id").GetString()){await Task.Delay(1000);continue;}
  monitor?.Dispose();monitor=new ClientWebSocket();target=t.Clone();await monitor.ConnectAsync(new Uri(t.GetProperty("webSocketDebuggerUrl").GetString()!),CancellationToken.None);Console.WriteLine("Connected to Character.AI");_=Watch(monitor);
 }catch(Exception e){Console.WriteLine("CDP: "+e.Message);EnsureBrowser();}
 await Task.Delay(1500);
}
async Task Server(){
 var l=new HttpListener();l.Prefixes.Add("http://127.0.0.1:8765/");l.Start();
 while(true){var c=await l.GetContextAsync();_=Task.Run(async()=>{try{
  var path=c.Request.Url?.AbsolutePath??"/";
  if(c.Request.HttpMethod=="GET"&&(path=="/"||path=="/index.html")){c.Response.ContentType="text/html; charset=utf-8";await c.Response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes(Page));}
  else if(c.Request.HttpMethod=="POST"&&path=="/speech"){using var rd=new StreamReader(c.Request.InputStream);var s=(await rd.ReadToEndAsync()).Trim();if(s.Length>0)await SendToCai(s);c.Response.StatusCode=204;}
  else if(c.Request.HttpMethod=="GET"&&path=="/status.txt"){c.Response.ContentType="text/plain";await c.Response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes(state.Message));}
  else if(c.Request.HttpMethod=="POST"&&path=="/status"){using var rd=new StreamReader(c.Request.InputStream);state.Message=await rd.ReadToEndAsync();c.Response.StatusCode=204;}
  else c.Response.StatusCode=404;
 }catch(Exception e){Console.WriteLine("HTTP: "+e.Message);c.Response.StatusCode=500;}finally{c.Response.Close();}});}
}
async Task SendToCai(string words){
 var t=target;if(t.ValueKind==JsonValueKind.Undefined){Console.WriteLine("No Character.AI tab yet: "+words);return;}
 // Use a separate CDP socket for commands so reply-monitor reads cannot steal command responses.
 using var ws=new ClientWebSocket();await ws.ConnectAsync(new Uri(t.GetProperty("webSocketDebuggerUrl").GetString()!),CancellationToken.None);
 var js="(()=>{const e=document.querySelector('[contenteditable=true][data-placeholder]')||document.querySelector('textarea')||document.querySelector('[contenteditable=true]');if(!e)return 'COMPOSER_NOT_FOUND';e.focus();const t="+JsonSerializer.Serialize(words)+";if(e.tagName==='TEXTAREA'){const p=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;p.call(e,(e.value?e.value+' ':'')+t);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t}));}else{document.execCommand('insertText',false,(e.innerText?' ':'')+t);}const b=[...document.querySelectorAll('button')].find(x=>/send/i.test((x.getAttribute('aria-label')||'')+' '+(x.innerText||''))&&!x.disabled);if(b)b.click();return b?'PASTED_AND_SENT':'PASTED (send button not found)'})()";
 var payload=JsonSerializer.Serialize(new{id=Interlocked.Increment(ref id),method="Runtime.evaluate",@params=new{expression=js,returnByValue=true}});
 await ws.SendAsync(Encoding.UTF8.GetBytes(payload),WebSocketMessageType.Text,true,CancellationToken.None);
 Console.WriteLine("Chrome transcript → CAI: "+words);state.Awaiting=true;
}
async Task Watch(ClientWebSocket ws){
 string last="";DateTime changed=DateTime.UtcNow;bool saw=false;
 while(ws.State==WebSocketState.Open){try{
  var js="(()=>{const a=[...document.querySelectorAll('[data-testid^=conversation-turn]')],e=a[a.length-1],text=e?.innerText||'',stop=[...document.querySelectorAll('button')].some(b=>/stop|cancel generation/i.test((b.getAttribute('aria-label')||'')+' '+b.innerText)),busy=document.querySelector('[aria-busy=true]')!==null;return JSON.stringify({text,stop,busy})})()";
  var q=JsonSerializer.Serialize(new{id=Interlocked.Increment(ref id),method="Runtime.evaluate",@params=new{expression=js,returnByValue=true}});
  await ws.SendAsync(Encoding.UTF8.GetBytes(q),WebSocketMessageType.Text,true,CancellationToken.None);
  var buf=new byte[65536];using var ms=new MemoryStream();while(true){var r=await ws.ReceiveAsync(buf,CancellationToken.None);ms.Write(buf,0,r.Count);if(r.EndOfMessage)break;}
  using var outer=JsonDocument.Parse(ms.ToArray());var val=outer.RootElement.GetProperty("result").GetProperty("result").GetProperty("value").GetString()??"{}";using var d=JsonDocument.Parse(val);var x=d.RootElement;var txt=x.GetProperty("text").GetString()??"";var busy=x.GetProperty("stop").GetBoolean()||x.GetProperty("busy").GetBoolean();
  if(busy){saw=true;changed=DateTime.UtcNow;last=txt;}
  else if(txt!=last){last=txt;changed=DateTime.UtcNow;}
  else if(state.Awaiting&&saw&&(DateTime.UtcNow-changed).TotalSeconds>=2){state.Awaiting=false;saw=false;Console.WriteLine("CAI reply completed; idle resumed.");}
  await Task.Delay(900);
 }catch(Exception e){Console.WriteLine("Reply monitor: "+e.Message);break;}}
}
void OpenSpeechPage(){var chrome=FindChrome();if(chrome==null)return;var profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CAIVoiceBridge","ChromeProfile");Directory.CreateDirectory(profile);var psi=new ProcessStartInfo{FileName=chrome,UseShellExecute=true};psi.ArgumentList.Add("--remote-debugging-port=9222");psi.ArgumentList.Add("--user-data-dir="+profile);psi.ArgumentList.Add("http://127.0.0.1:8765/");Process.Start(psi);}
void EnsureBrowser(){try{using var c=new HttpClient{Timeout=TimeSpan.FromSeconds(1)};c.GetAsync("http://127.0.0.1:9222/json").GetAwaiter().GetResult();return;}catch{}
 var chrome=FindChrome();if(chrome==null){Console.WriteLine("Google Chrome not found.");return;}
 var profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CAIVoiceBridge","ChromeProfile");Directory.CreateDirectory(profile);
 Process.Start(new ProcessStartInfo{FileName=chrome,Arguments=$"--remote-debugging-port=9222 --user-data-dir=\"{profile}\" https://character.ai",UseShellExecute=true});
}
string? FindChrome(){var p=new[]{Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google","Chrome","Application","chrome.exe")};return p.FirstOrDefault(File.Exists);}
class BridgeState{public volatile bool Awaiting;public volatile string Message="";}
