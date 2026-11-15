using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
using System.Speech.Recognition;
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
    readonly Label status=new(){AutoSize=true,Text="Ready — launch Chrome with remote debugging and open Character.AI."};
    readonly TextBox transcript=new(){Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill};
    readonly Button start=new(){Text="START LISTENING",Height=44,Dock=DockStyle.Top};
    SpeechRecognitionEngine engine; HttpListener server; CancellationTokenSource cts;
    public MainForm(){Text="CAI Voice Transmitter";Width=720;Height=500;StartPosition=FormStartPosition.CenterScreen;
      var top=new Panel{Dock=DockStyle.Top,Height=95};top.Controls.Add(status);status.Left=12;status.Top=8;start.Top=38;top.Controls.Add(start);Controls.Add(transcript);Controls.Add(top);
      start.Click+=async(_,__)=>{if(engine!=null){Stop();return;}await Begin();};FormClosing+=(_,__)=>Stop();}
    async Task Begin(){
      try{
        engine=new SpeechRecognitionEngine(new System.Globalization.CultureInfo("en-US"));engine.SetInputToDefaultAudioDevice();
        engine.LoadGrammar(new DictationGrammar());engine.SpeechRecognized+=Recognized;engine.SpeechRecognitionRejected+=(_,e)=>Set("Heard unclear speech; keep talking...");
        engine.RecognizeCompleted+=(_,__)=>{if(engine!=null)try{engine.RecognizeAsync(RecognizeMode.Multiple);}catch{}};
        cts=new CancellationTokenSource();server=new HttpListener();server.Prefixes.Add("http://127.0.0.1:8765/");server.Start();_=Serve(cts.Token);
        engine.RecognizeAsync(RecognizeMode.Multiple);start.Text="STOP LISTENING";Set("Listening on your default microphone. Speak a sentence.");
      }catch(Exception ex){Stop();Set("Could not start: "+ex.Message);}
      await Task.CompletedTask;
    }
    async Task Serve(CancellationToken ct){while(!ct.IsCancellationRequested){HttpListenerContext x=null;try{x=await server.GetContextAsync();var body=Encoding.UTF8.GetString(await new StreamReader(x.Request.InputStream).ReadToEndAsync());if(x.Request.Url.AbsolutePath=="/transcript"){await SendToCai(body);x.Response.StatusCode=204;}else{byte[] b=Encoding.UTF8.GetBytes("{\"app\":\"CAI Voice Transmitter\",\"listening\":true}");x.Response.ContentType="application/json";await x.Response.OutputStream.WriteAsync(b);}}catch{try{x?.Response.Close();}catch{}if(server==null||!server.IsListening)break;}}}
    async void Recognized(object s,SpeechRecognizedEventArgs e){if(e.Result.Confidence<.55)return;string text=e.Result.Text.Trim();if(text.Length==0)return;Append("YOU: "+text);try{await SendToCai(text);}catch(Exception ex){Set("Transcript recognized but CAI send failed: "+ex.Message);}}
    async Task SendToCai(string text){
      using var http=new HttpClient();var targets=JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json"));
      var page=targets.RootElement.EnumerateArray().FirstOrDefault(t=>t.TryGetProperty("type",out var ty)&&ty.GetString()=="page"&&t.TryGetProperty("url",out var u)&&u.GetString().Contains("character.ai"));
      if(page.ValueKind==JsonValueKind.Undefined)throw new Exception("No Character.AI tab found on Chrome CDP port 9222.");
      string wsurl=page.GetProperty("webSocketDebuggerUrl").GetString();using var ws=new ClientWebSocket();await ws.ConnectAsync(new Uri(wsurl),CancellationToken.None);
      string js="(()=>{const text="+JsonSerializer.Serialize(text)+";const xs=[...document.querySelectorAll('textarea,input,[contenteditable=true],[role=textbox]')].filter(e=>e.getClientRects().length);const box=xs.find(e=>/message|chat|reply|type/i.test((e.placeholder||'')+' '+(e.getAttribute('aria-label')||'')))||xs.at(-1);if(!box)return 'INPUT_NOT_FOUND';box.focus();if(box.tagName==='TEXTAREA'||box.tagName==='INPUT'){const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box),'value');d?.set?d.set.call(box,text):box.value=text;}else{box.textContent=text;}box.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));const form=box.closest('form');const btn=form?.querySelector('button[type=submit]');if(btn&&!btn.disabled){btn.click();return 'SENT_BUTTON';}box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',which:13,keyCode:13,bubbles:true}));box.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',which:13,keyCode:13,bubbles:true}));return 'SENT_ENTER';})()";
      string packet=JsonSerializer.Serialize(new{ id=1,method="Runtime.evaluate",@params=new{expression=js,returnByValue=true}});await ws.SendAsync(Encoding.UTF8.GetBytes(packet),WebSocketMessageType.Text,true,CancellationToken.None);
      var buf=new byte[8192];var res=await ws.ReceiveAsync(buf,CancellationToken.None);string output=Encoding.UTF8.GetString(buf,0,res.Count);Append("CDP: "+output);Set("Sent recognized text to Character.AI.");
    }
    void Append(string s){if(IsDisposed)return;BeginInvoke(()=>{transcript.AppendText(s+Environment.NewLine);});}
    void Set(string s){if(IsDisposed)return;BeginInvoke(()=>status.Text=s);}
    void Stop(){try{engine?.RecognizeAsyncCancel();engine?.Dispose();}catch{}engine=null;try{cts?.Cancel();server?.Stop();server?.Close();}catch{}server=null;start.Text="START LISTENING";Set("Stopped.");}
}