using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace CaiVoiceTransmitter;
internal static class Program
{
    [STAThread] static void Main(){ApplicationConfiguration.Initialize();Application.Run(new MainForm());}
}
sealed class MainForm:Form
{
    readonly Label status=new(){AutoSize=true,Text="Browser-only: Chrome Character.AI tab (CDP 9222). No desktop app."};
    readonly TextBox log=new(){Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill};
    readonly Button start=new(){Text="START LOCAL SPEECH BRIDGE",Height=44,Dock=DockStyle.Top};
    HttpListener server;CancellationTokenSource cts;bool running;
    const string BridgeHtml=@"<!doctype html><html><head><meta charset=utf-8><title>Character.AI Chrome Speech Bridge</title><style>body{font:16px Segoe UI;background:#171923;color:#eee;padding:30px;max-width:720px;margin:auto}button{padding:14px 22px;font-size:16px;background:#5865f2;color:white;border:0;border-radius:8px}#state{margin:18px 0;color:#9fe5a9}#last{padding:15px;background:#252837;border-radius:8px;min-height:45px;white-space:pre-wrap}</style></head><body><h1>CAI Local Speech Bridge</h1><p>Chrome mic → localhost bridge → Chrome Character.AI tab via CDP</p><button id=start>START MICROPHONE</button><div id=state>Stopped</div><h3>Latest finalized transcript</h3><div id=last></div><script>
const state=document.querySelector('#state'),last=document.querySelector('#last'),btn=document.querySelector('#start');let r,active=false;
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
if(!SR){state.textContent='SpeechRecognition unavailable. Use Chrome.';btn.disabled=true;}
function begin(){if(!SR)return;r=new SR();r.lang='en-US';r.continuous=true;r.interimResults=false;r.maxAlternatives=1;
r.onstart=()=>{active=true;btn.textContent='STOP MICROPHONE';state.textContent='Listening…';};
r.onresult=async e=>{for(let i=e.resultIndex;i<e.results.length;i++){if(!e.results[i].isFinal)continue;let t=e.results[i][0].transcript.trim();if(!t)continue;last.textContent=t;state.textContent='Sending: '+t;try{let q=await fetch('/transcript',{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:t});state.textContent=q.ok?'Delivered to CAI EXE':'EXE returned '+q.status;}catch(err){state.textContent='EXE connection error: '+err.message;}}};
r.onerror=e=>{state.textContent='Speech error: '+e.error+' (click Start again if needed)';};
r.onend=()=>{if(active){setTimeout(()=>{try{r.start()}catch{}},500)}else{btn.textContent='START MICROPHONE';state.textContent='Stopped';}};
try{active=true;r.start()}catch(e){active=false;state.textContent=e.message}
}
btn.onclick=()=>{if(active){active=false;try{r.stop()}catch{}btn.textContent='START MICROPHONE';state.textContent='Stopped'}else begin()};
</script></body></html>";
    public MainForm(){Text="Character.AI Browser Voice Transmitter";Width=760;Height=520;StartPosition=FormStartPosition.CenterScreen;var top=new Panel{Dock=DockStyle.Top,Height=100};status.Left=12;status.Top=8;start.Top=40;top.Controls.Add(status);top.Controls.Add(start);Controls.Add(log);Controls.Add(top);start.Click+=async(_,__)=>{if(running){StopBridge();return;}await StartBridge();};FormClosing+=(_,__)=>StopBridge();}
    async Task StartBridge(){try{server=new HttpListener();server.Prefixes.Add("http://127.0.0.1:8765/");server.Start();cts=new CancellationTokenSource();running=true;_=Serve(cts.Token);start.Text="STOP LOCAL SPEECH BRIDGE";Set("Bridge online at http://127.0.0.1:8765/");Append("Browser-only flow: open localhost bridge in Chrome, click START MICROPHONE, then transcript is inserted into character.ai web chat.");try{Process.Start(new ProcessStartInfo("http://127.0.0.1:8765/"){UseShellExecute=true});}catch{} }catch(Exception ex){Set("Bridge start failed: "+ex.Message);}await Task.CompletedTask;}
    async Task Serve(CancellationToken ct){while(!ct.IsCancellationRequested){HttpListenerContext x=null;try{x=await server.GetContextAsync();string path=x.Request.Url.AbsolutePath;if(path=="/transcript"&&x.Request.HttpMethod=="POST"){string text=await new StreamReader(x.Request.InputStream,Encoding.UTF8).ReadToEndAsync();text=text.Trim();if(text.Length>0){Append("MIC: "+text);string result=await SendToCai(text);Append("CAI: "+result);byte[] b=Encoding.UTF8.GetBytes(result);x.Response.ContentType="text/plain";await x.Response.OutputStream.WriteAsync(b);}}else{byte[] b=Encoding.UTF8.GetBytes(BridgeHtml);x.Response.ContentType="text/html; charset=utf-8";await x.Response.OutputStream.WriteAsync(b);}x.Response.Close();}catch(Exception ex){try{x?.Response.Close();}catch{}if(server==null||!server.IsListening)break;Append("HTTP: "+ex.Message);}}}
    async Task<string> SendToCai(string text){using var http=new HttpClient();var targets=JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json"));var page=targets.RootElement.EnumerateArray().FirstOrDefault(t=>t.TryGetProperty("type",out var ty)&&ty.GetString()=="page"&&t.TryGetProperty("url",out var u)&&(u.GetString()??"").Contains("character.ai",StringComparison.OrdinalIgnoreCase));if(page.ValueKind==JsonValueKind.Undefined)throw new Exception("No Character.AI WEB TAB found in Chrome remote debugging (port 9222). Open character.ai in that Chrome window; desktop app is not used.");using var ws=new ClientWebSocket();await ws.ConnectAsync(new Uri(page.GetProperty("webSocketDebuggerUrl").GetString()),CancellationToken.None);
string js="""(()=>{const text="""+JsonSerializer.Serialize(text)+""";const vis=e=>e.getClientRects().length>0;const all=[...document.querySelectorAll('textarea,input,[contenteditable=true],[role=textbox]')].filter(vis);const box=all.find(e=>/message|chat|reply|type/i.test((e.placeholder||'')+' '+(e.getAttribute('aria-label')||'')))||all.at(-1);if(!box)return 'INPUT_NOT_FOUND';box.focus();if(box.matches('textarea,input')){const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box),'value');d?.set?d.set.call(box,text):box.value=text;}else box.textContent=text;box.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));const form=box.closest('form'),submit=form?.querySelector('button[type=submit]');if(submit&&!submit.disabled)submit.click();else{box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',which:13,keyCode:13,bubbles:true}));box.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',which:13,keyCode:13,bubbles:true}));}return 'TEXT_SENT';})()""";
await Eval(ws,js);await Task.Delay(1200);string triangle=await Eval(ws,"""(()=>{const visible=e=>e.getClientRects().length>0;const replies=[...document.querySelectorAll('[data-message-author-role=assistant], [class*=message], [class*=Message]')].filter(visible);const root=replies.at(-1)||document.body;const svgs=[...root.querySelectorAll('button svg, [role=button] svg, svg')].filter(visible);const blue=s=>{const z=s.outerHTML.toLowerCase(),p=[...s.querySelectorAll('path')].map(x=>(x.getAttribute('fill')||getComputedStyle(x).fill||'')+' '+(x.getAttribute('stroke')||getComputedStyle(x).stroke||'')).join(' ').toLowerCase(),c=getComputedStyle(s).color;return (/play|triangle/.test(z)||/polygon|M.*L.*L/.test(z))&&(/blue|#5865f2|#3b82f6/.test(p+' '+c)||s.querySelectorAll('path').length===1)};const s=svgs.find(blue);if(!s)return 'BLUE_TRIANGLE_NOT_FOUND';const b=s.closest('button,[role=button]')||s;b.click();return 'BLUE_TRIANGLE_CLICKED';})()""");
await ws.CloseAsync(WebSocketCloseStatus.NormalClosure,"done",CancellationToken.None);return triangle;}
    async Task<string> Eval(ClientWebSocket ws,string expression){string packet=JsonSerializer.Serialize(new{id=1,method="Runtime.evaluate",@params=new{expression,returnByValue=true}});await ws.SendAsync(Encoding.UTF8.GetBytes(packet),WebSocketMessageType.Text,true,CancellationToken.None);var buf=new byte[16384];var res=await ws.ReceiveAsync(buf,CancellationToken.None);return Encoding.UTF8.GetString(buf,0,res.Count);}
    void Append(string s){if(IsDisposed)return;BeginInvoke(()=>log.AppendText(s+Environment.NewLine));}void Set(string s){if(IsDisposed)return;BeginInvoke(()=>status.Text=s);}
    void StopBridge(){running=false;try{cts?.Cancel();server?.Stop();server?.Close();}catch{}server=null;start.Text="START LOCAL SPEECH BRIDGE";Set("Stopped.");}
}