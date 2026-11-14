using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;
using System.Diagnostics;
using System.Net.Http;
using System.Text;
using System.Text.Json;

ApplicationConfiguration.Initialize();
var form=new Form{Text="CAI Voice Bridge",Width=700,Height=600,StartPosition=FormStartPosition.CenterScreen};
var status=new Label{Dock=DockStyle.Top,Height=34,Text="Starting embedded Chrome speech…",TextAlign=ContentAlignment.MiddleLeft};
var transcript=new TextBox{Dock=DockStyle.Fill,Multiline=true,ScrollBars=ScrollBars.Vertical,Font=new System.Drawing.Font("Segoe UI",13),ReadOnly=true};
var send=new Button{Dock=DockStyle.Bottom,Height=42,Text="Send transcript to Character.AI"};
form.Controls.Add(transcript);form.Controls.Add(send);form.Controls.Add(status);
var web=new WebView2{Visible=false,Width=1,Height=1};
form.Controls.Add(web);
string latest="";
send.Click+=async(_,_)=>{if(latest.Length>0)status.Text=await SendToCai(latest);};
web.CoreWebView2InitializationCompleted+=(_,e)=>{if(e.IsSuccess){web.CoreWebView2.WebMessageReceived+=async(_,a)=>{try{var msg=a.TryGetWebMessageAsString();if(msg.StartsWith("status:"))status.Text=msg[7..];else{latest=msg;transcript.AppendText(msg+Environment.NewLine);status.Text="Recognized → ready to send";await SendToCai(msg);}}catch(Exception ex){status.Text=ex.Message;}};web.CoreWebView2.NavigateToString("""
<!doctype html><meta charset="utf-8"><button id="start">Start Chrome Recognition</button><script>
const b=document.querySelector('#start');let r,active=false;
function status(s){chrome.webview.postMessage('status:'+s)}
function start(){const SR=SpeechRecognition||webkitSpeechRecognition;if(!SR){status('SpeechRecognition unavailable');return}
r=new SR();r.lang='en-US';r.continuous=true;r.interimResults=true;r.onstart=()=>status('Embedded Chrome listening…');r.onerror=e=>status('Speech error: '+e.error);r.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal){const t=e.results[i][0].transcript.trim();if(t)chrome.webview.postMessage(t)}};r.onend=()=>{if(active)setTimeout(()=>{try{r.start()}catch{}},500)};active=true;b.textContent='Stop Recognition';r.start()}
b.onclick=()=>{if(active){active=false;r.stop();b.textContent='Start Chrome Recognition'}else start()};setTimeout(()=>{try{start()}catch{}},800);
</script>
"""
); }else status.Text="WebView2 init failed: "+e.InitializationException?.Message;};
form.Shown+=async(_,_)=>{try{await web.EnsureCoreWebView2Async();}catch(Exception e){status.Text="Install Microsoft Edge WebView2 Runtime: "+e.Message;}};
Application.Run(form);

async Task<string> SendToCai(string words){
 try{
 using var http=new HttpClient{Timeout=TimeSpan.FromSeconds(2)};
 var pages=JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json"));
 var tab=pages.RootElement.EnumerateArray().FirstOrDefault(x=>x.TryGetProperty("url",out var u)&&u.GetString()!.Contains("character.ai",StringComparison.OrdinalIgnoreCase));
 if(tab.ValueKind==JsonValueKind.Undefined)return "Open Character.AI in the EXE-launched Chrome (debug port 9222).";
 using var ws=new System.Net.WebSockets.ClientWebSocket();await ws.ConnectAsync(new Uri(tab.GetProperty("webSocketDebuggerUrl").GetString()!),CancellationToken.None);
 var js="(()=>{const e=document.querySelector('[contenteditable=true][data-placeholder]')||document.querySelector('textarea')||document.querySelector('[contenteditable=true]');if(!e)return 'Composer not found';e.focus();const t="+JsonSerializer.Serialize(words)+";document.execCommand('insertText',false,(e.innerText?' ':'')+t);e.dispatchEvent(new InputEvent('input',{bubbles:true}));const b=[...document.querySelectorAll('button')].find(x=>/send/i.test((x.getAttribute('aria-label')||'')+' '+x.innerText)&&!x.disabled);if(b)b.click();return b?'Pasted and sent to Character.AI':'Pasted; Send button not found'})()";
 var q=JsonSerializer.Serialize(new{id=1,method="Runtime.evaluate",@params=new{expression=js,returnByValue=true}});
 await ws.SendAsync(Encoding.UTF8.GetBytes(q),System.Net.WebSockets.WebSocketMessageType.Text,true,CancellationToken.None);
 var buf=new byte[8192];var rr=await ws.ReceiveAsync(buf,CancellationToken.None);using var d=JsonDocument.Parse(buf.AsMemory(0,rr.Count));return d.RootElement.GetProperty("result").GetProperty("result").GetProperty("value").GetString()??"Sent";
 }catch(Exception e){return "CAI send issue: "+e.Message;}
}
