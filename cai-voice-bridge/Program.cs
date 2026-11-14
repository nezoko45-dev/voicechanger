using System.Text;
using System.Text.Json;
using System.Threading;

ApplicationConfiguration.Initialize();
var form = new Form { Text = "CAI Voice Bridge — Chrome Native Messaging", Width = 620, Height = 460, StartPosition = FormStartPosition.CenterScreen };
var status = new Label { Dock = DockStyle.Top, Height = 36, Text = "Waiting for Chrome speech…", TextAlign = ContentAlignment.MiddleLeft };
var transcript = new TextBox { Dock = DockStyle.Fill, Multiline = true, ScrollBars = ScrollBars.Vertical, Font = new System.Drawing.Font("Segoe UI", 13) };
var send = new Button { Dock = DockStyle.Bottom, Height = 42, Text = "Send current text to Character.AI" };
form.Controls.Add(transcript); form.Controls.Add(send); form.Controls.Add(status);
string latest = "";
send.Click += async (_, _) => { if (!string.IsNullOrWhiteSpace(transcript.Text)) { latest = transcript.Text; status.Text = await SendToCai(latest); } };
var pipe = new NativePipe(transcript, status, value => latest = value);
form.Shown += (_, _) => { status.Text = "Ready. Open the CAI Voice Bridge extension and press Start listening."; _ = Task.Run(pipe.ReadLoop); };
Application.Run(form);

static async Task<string> SendToCai(string words)
{
 try {
  using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
  var pages = JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json"));
  var tab = pages.RootElement.EnumerateArray().FirstOrDefault(x => x.TryGetProperty("url", out var u) && u.GetString()!.Contains("character.ai", StringComparison.OrdinalIgnoreCase));
  if (tab.ValueKind == JsonValueKind.Undefined) return "No debug Chrome found. Start Chrome with remote debugging port 9222.";
  using var ws = new System.Net.WebSockets.ClientWebSocket();
  await ws.ConnectAsync(new Uri(tab.GetProperty("webSocketDebuggerUrl").GetString()!), CancellationToken.None);
  var js = "(()=>{const e=document.querySelector('[contenteditable=true][data-placeholder]')||document.querySelector('textarea')||document.querySelector('[contenteditable=true]');if(!e)return 'Composer not found';e.focus();const t="+JsonSerializer.Serialize(words)+";if(e.tagName==='TEXTAREA'){const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;s.call(e,(e.value?' ':'')+t)}else document.execCommand('insertText',false,(e.innerText?' ':'')+t);e.dispatchEvent(new InputEvent('input',{bubbles:true}));const b=[...document.querySelectorAll('button')].find(x=>/send/i.test((x.getAttribute('aria-label')||'')+' '+x.innerText)&&!x.disabled);if(b)b.click();return b?'Pasted and sent':'Pasted; Send button not found'})()";
  var q = JsonSerializer.Serialize(new { id=1, method="Runtime.evaluate", @params=new { expression=js, returnByValue=true } });
  await ws.SendAsync(Encoding.UTF8.GetBytes(q), System.Net.WebSockets.WebSocketMessageType.Text, true, CancellationToken.None);
  var buf=new byte[8192]; var rr=await ws.ReceiveAsync(buf,CancellationToken.None);
  using var d=JsonDocument.Parse(buf.AsMemory(0,rr.Count));
  return d.RootElement.GetProperty("result").GetProperty("result").GetProperty("value").GetString() ?? "Sent";
 } catch(Exception e) { return "CAI send failed: "+e.Message; }
}

sealed class NativePipe(TextBox box, Label label, Action<string> setLatest)
{
 public async Task ReadLoop()
 {
  var input=Console.OpenStandardInput(); var output=Console.OpenStandardOutput();
  while(true)
  {
   byte[] header=new byte[4]; if(!await ReadExact(input,header))return;
   int len=BitConverter.ToInt32(header); if(len<1||len>1024*1024)return;
   byte[] data=new byte[len]; if(!await ReadExact(input,data))return;
   string text="";
   try { using var j=JsonDocument.Parse(data); text=j.RootElement.TryGetProperty("text",out var t)?t.GetString()??"":""; }
   catch {}
   if(text.Length>0)
   {
    setLatest(text);
    if(box.IsHandleCreated)box.BeginInvoke(()=>{box.AppendText(text+Environment.NewLine);label.Text="Chrome recognized: "+text;});
   }
   var reply=JsonSerializer.SerializeToUtf8Bytes(new { ok=true, received=text });
   await output.WriteAsync(BitConverter.GetBytes(reply.Length)); await output.WriteAsync(reply); await output.FlushAsync();
  }
 }
 static async Task<bool> ReadExact(Stream s,byte[] b){int n=0;while(n<b.Length){int k=await s.ReadAsync(b.AsMemory(n));if(k==0)return false;n+=k;}return true;}
}