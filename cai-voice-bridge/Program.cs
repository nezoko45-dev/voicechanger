using System.Diagnostics;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Speech.Recognition;

const string SpeechPage = """
<!doctype html><html><head><meta charset="utf-8"><title>CAI Local Whisper</title>
<style>body{font:16px system-ui;background:#17171b;color:#eee;max-width:650px;margin:40px auto;padding:20px}button{font-size:18px;padding:12px 20px}#status{color:#9f9;margin:15px 0}textarea{box-sizing:border-box;width:100%;height:150px;background:#24242a;color:#eee;padding:12px;border:0;border-radius:8px;font:16px system-ui}</style></head>
<body><h2>Character.AI — Windows Speech Recognition</h2><button id="toggle">Start Windows Recognition</button><div id="status">Windows speech recognition ready — click Start</div><h3>Whisper transcription</h3><textarea id="heard" placeholder="Local Whisper output appears here…" readonly></textarea>
<script>
let enabled=false;const status=document.querySelector('#status'),heard=document.querySelector('#heard'),btn=document.querySelector('#toggle');
function say(s){status.textContent=s}
async function poll(){try{let r=await fetch('/status.txt');let s=await r.text();if(s)say(s)}catch{}}
setInterval(async()=>{await poll();try{let r=await fetch('/micstatus');let x=await r.text();if(x)say(x)}catch{}},1000);
btn.onclick=async()=>{if(!enabled){btn.disabled=true;btn.textContent='Starting Windows Speech…';say('Starting Windows speech recognition…');try{let r=await fetch('/mic',{method:'POST',body:'start'});if(!r.ok)throw new Error(await r.text()||('HTTP '+r.status));enabled=true;btn.textContent='Stop Recognition';say('Windows speech recognition started. Speak now.')}catch(e){enabled=false;btn.textContent='Start Local Recognition';say('START FAILED: '+e.message)}finally{btn.disabled=false}}else{enabled=false;btn.textContent='Start Local Recognition';try{await fetch('/mic',{method:'POST',body:'stop'});say('Recognition stopped')}catch(e){say('Stop error: '+e.message)}}};
async function transcript(){try{let r=await fetch('/transcript');let t=await r.text();if(t){heard.value+=(heard.value?'
':'')+t;say('Whisper recognized: '+t)}}catch{}}
setInterval(transcript,500);
</script></body></html>
""";

const int DebugPort = 9222;
const int LocalPort = 8765;
const string DebugEndpoint = "http://127.0.0.1:9222/json";
using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
Console.Title = "Character.AI Voice Bridge";
Console.WriteLine("Character.AI Voice Bridge — Chrome speech recognition + reply-aware idle");
int commandId = 0;
ClientWebSocket? caiSocket = null;
JsonElement caiTarget = default;
volatileState idleState = new();
var speech = new LocalWhisper(PasteIntoCai);

_ = RunLocalSpeechServer();
EnsureDebugBrowser();
OpenSpeechPage();
Console.WriteLine($"Speech page: http://127.0.0.1:{LocalPort}/");
Console.WriteLine("Waiting for Character.AI tab...");

while (true)
{
    try
    {
        using var response = await http.GetAsync(DebugEndpoint);
        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var target = doc.RootElement.EnumerateArray().FirstOrDefault(x =>
            x.TryGetProperty("type", out var type) && type.GetString() == "page" &&
            x.TryGetProperty("url", out var url) && url.GetString()!.Contains("character.ai", StringComparison.OrdinalIgnoreCase));

        if (target.ValueKind == JsonValueKind.Undefined) { await Task.Delay(1500); continue; }
        if (caiSocket?.State == WebSocketState.Open && caiTarget.GetProperty("id").GetString() == target.GetProperty("id").GetString()) { await Task.Delay(1000); continue; }
        caiSocket?.Dispose();
        caiSocket = new ClientWebSocket();
        caiSocket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        caiTarget = target.Clone();
        await caiSocket.ConnectAsync(new Uri(target.GetProperty("webSocketDebuggerUrl").GetString()!), CancellationToken.None);
        Console.WriteLine("Connected to Character.AI. Listening for reply completion...");
        _ = MonitorCaiReplies(caiSocket);
    }
    catch (Exception ex) { Console.WriteLine($"CDP reconnect: {ex.Message}"); EnsureDebugBrowser(); }
    await Task.Delay(1500);
}

async Task MonitorCaiReplies(ClientWebSocket socket)
{
    // Track the assistant's latest message text and streaming indicator. Idle resumes only after
    // assistant output stops changing and the UI no longer shows a generating/stop button.
    string lastText = "";
    DateTime lastChange = DateTime.UtcNow;
    bool sawGeneration = false;
    while (socket.State == WebSocketState.Open)
    {
        try
        {
            var js = @"(()=>{const turns=[...document.querySelectorAll('[data-testid^=conversation-turn]')];const last=turns[turns.length-1];const text=last?.innerText||'';const stop=[...document.querySelectorAll('button')].some(b=>/stop|cancel generation/i.test((b.getAttribute('aria-label')||'')+' '+b.innerText));const busy=document.querySelector('[aria-busy=true]')!==null;return JSON.stringify({text,stop,busy})})()";
            var id=Interlocked.Increment(ref commandId);
            var cmd=JsonSerializer.Serialize(new { id, method="Runtime.evaluate", @params=new { expression=js, returnByValue=true }});
            await socket.SendAsync(Encoding.UTF8.GetBytes(cmd),WebSocketMessageType.Text,true,CancellationToken.None);
            var buf=new byte[65536]; string raw="";
            using var ms=new MemoryStream();
            while(true){var r=await socket.ReceiveAsync(buf,CancellationToken.None);ms.Write(buf,0,r.Count);if(r.EndOfMessage)break;}
            raw=Encoding.UTF8.GetString(ms.ToArray());
            using var outer=JsonDocument.Parse(raw);
            if(!outer.RootElement.TryGetProperty("result",out var result)||!result.TryGetProperty("result",out var value)||!value.TryGetProperty("value",out var v)){await Task.Delay(900);continue;}
            using var stateDoc=JsonDocument.Parse(v.GetString()??"{}");
            var root=stateDoc.RootElement;var textNow=root.GetProperty("text").GetString()??"";var generating=root.GetProperty("stop").GetBoolean()||root.GetProperty("busy").GetBoolean();
            if(generating){sawGeneration=true;lastChange=DateTime.UtcNow;lastText=textNow;idleState.AwaitingReply=true;}
            else if(textNow!=lastText){lastText=textNow;lastChange=DateTime.UtcNow;if(idleState.AwaitingReply)sawGeneration=true;}
            else if(idleState.AwaitingReply&&sawGeneration&&(DateTime.UtcNow-lastChange).TotalSeconds>=2){
                idleState.AwaitingReply=false;sawGeneration=false;Console.WriteLine("AI reply finished → speech idle resumed.");
                await NotifySpeechPage("AI finished replying. Idle/listening resumed.");
            }
            await Task.Delay(900);
        }catch(Exception ex){Console.WriteLine("Reply monitor: "+ex.Message);break;}
    }
}

async Task NotifySpeechPage(string msg)
{
    try{using var c=new HttpClient();await c.PostAsync($"http://127.0.0.1:{LocalPort}/status",new StringContent(msg));}catch{}
}

async Task RunLocalSpeechServer()
{
    var listener = new HttpListener();
    listener.Prefixes.Add($"http://127.0.0.1:{LocalPort}/");
    listener.Start();
    while (true)
    {
        var ctx = await listener.GetContextAsync();
        _ = Task.Run(async () =>
        {
            try
            {
                if (ctx.Request.HttpMethod == "GET" && (ctx.Request.Url?.AbsolutePath == "/" || ctx.Request.Url?.AbsolutePath == "/index.html"))
                {
                    ctx.Response.ContentType = "text/html; charset=utf-8";
                    await ctx.Response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes(SpeechPage));
                }
                else if(ctx.Request.HttpMethod=="POST"&&ctx.Request.Url?.AbsolutePath=="/mic"){using var rd=new StreamReader(ctx.Request.InputStream);var act=await rd.ReadToEndAsync();if(act=="start")await speech.Start();else await speech.Stop();ctx.Response.StatusCode=204;}
                else if(ctx.Request.HttpMethod=="GET"&&ctx.Request.Url?.AbsolutePath=="/transcript"){ctx.Response.ContentType="text/plain";await ctx.Response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes(speech.TakeTranscript()));}
                else if(ctx.Request.HttpMethod=="GET"&&ctx.Request.Url?.AbsolutePath=="/micstatus"){ctx.Response.ContentType="text/plain";await ctx.Response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes(speech.Status));}
                else if (ctx.Request.HttpMethod == "GET" && ctx.Request.Url?.AbsolutePath == "/status.txt")
                {
                    ctx.Response.ContentType = "text/plain; charset=utf-8";
                    var message = idleState.UiMessage; idleState.UiMessage = "";
                    await ctx.Response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes(message));
                }
                else if (ctx.Request.HttpMethod == "POST" && ctx.Request.Url?.AbsolutePath == "/speech")
                {
                    using var reader = new StreamReader(ctx.Request.InputStream, ctx.Request.ContentEncoding);
                    var transcript = (await reader.ReadToEndAsync()).Trim();
                    if (transcript.Length > 0) await PasteIntoCai(transcript);
                    ctx.Response.StatusCode = 204;
                }
                else if(ctx.Request.HttpMethod=="POST"&&ctx.Request.Url?.AbsolutePath=="/status")
                {
                    using var reader=new StreamReader(ctx.Request.InputStream,ctx.Request.ContentEncoding);
                    idleState.UiMessage=await reader.ReadToEndAsync();ctx.Response.StatusCode=204;
                }
                else ctx.Response.StatusCode = 404;
            }
            catch (Exception e) { Console.WriteLine("Local request: " + e.Message); ctx.Response.StatusCode = 500; }
            finally { ctx.Response.Close(); }
        });
    }
}

async Task PasteIntoCai(string words)
{
    var ws = caiSocket;
    if (ws?.State != WebSocketState.Open) { Console.WriteLine("Transcript received but Character.AI is not connected: " + words); return; }
    var js = @"(()=>{const e=document.querySelector('[contenteditable=true][data-placeholder],textarea')||document.querySelector('[contenteditable=true]');if(!e)return 'COMPOSER_NOT_FOUND';e.focus();const t=" + JsonSerializer.Serialize(words) + @";if(e.tagName==='TEXTAREA'){const s=e.value;const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(e,(s?s+' ':'')+t);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t}));}else{document.execCommand('insertText',false,(e.innerText?' ':'')+t);}return 'PASTED: '+t})()";
    var payload = JsonSerializer.Serialize(new { id = Interlocked.Increment(ref commandId), method = "Runtime.evaluate", @params = new { expression = js, returnByValue = true } });
    await ws.SendAsync(Encoding.UTF8.GetBytes(payload), WebSocketMessageType.Text, true, CancellationToken.None);
    idleState.AwaitingReply = true;
    Console.WriteLine("Speech → Character.AI: " + words + " (waiting for AI reply before idle)");
}

void OpenSpeechPage()
{
    var browser = FindChrome(); if (browser is null) return;
    var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CAIVoiceBridge", "ChromeProfile");
    Process.Start(new ProcessStartInfo { FileName = browser, Arguments = $"--remote-debugging-port={DebugPort} --user-data-dir=\"{profile}\" http://127.0.0.1:{LocalPort}/", UseShellExecute = true });
}
void EnsureDebugBrowser()
{
    try { using var check = new HttpClient { Timeout = TimeSpan.FromSeconds(1) }; check.GetAsync(DebugEndpoint).GetAwaiter().GetResult(); return; } catch { }
    var browser = FindChrome(); if (browser is null) { Console.WriteLine("Chrome not found. Install Google Chrome and restart."); return; }
    var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CAIVoiceBridge", "ChromeProfile");Directory.CreateDirectory(profile);
    Process.Start(new ProcessStartInfo { FileName = browser, Arguments = $"--remote-debugging-port={DebugPort} --user-data-dir=\"{profile}\" https://character.ai", UseShellExecute = true });
}
string? FindChrome()
{
    var paths=new[]{Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google","Chrome","Application","chrome.exe")};
    return paths.FirstOrDefault(File.Exists);
}



class volatileState { public volatile bool AwaitingReply; public volatile string UiMessage=""; }


class LocalWhisper {
readonly Func<string,Task> sendToCai; public LocalWhisper(Func<string,Task> send){sendToCai=send;}
SpeechRecognitionEngine? engine; readonly object gate=new(); readonly StringBuilder output=new(); bool running; public string Status{get;private set;}="Windows speech recognition ready. Click Start.";
public Task Start(){if(running)return Task.CompletedTask;try{
Status="Checking installed Windows speech recognizers…";
var info=SpeechRecognitionEngine.InstalledRecognizers().FirstOrDefault(x=>x.Culture.Name.StartsWith("en",StringComparison.OrdinalIgnoreCase));
if(info==null)throw new InvalidOperationException("No English Windows speech recognition pack is installed. Install English speech recognition in Windows Settings > Time & language > Speech.");
engine=new SpeechRecognitionEngine(info);engine.SetInputToDefaultAudioDevice();engine.LoadGrammar(new DictationGrammar());
engine.SpeechRecognized+=(s,e)=>{var text=e.Result?.Text?.Trim();if(string.IsNullOrWhiteSpace(text)||e.Result.Confidence<0.35)return;lock(gate)output.AppendLine(text);Status="Recognized: "+text;Console.WriteLine("Windows Speech: "+text);_ = sendToCai(text);};
engine.SpeechRecognitionRejected+=(s,e)=>Status="Listening… (speech unclear; try speaking closer to the mic)";
engine.AudioLevelUpdated+=(s,e)=>Status=$"Windows speech recognition listening — mic level {e.AudioLevel}%";
engine.RecognizeAsync(RecognizeMode.Multiple);running=true;Status="Windows speech recognition active. Speak naturally.";Console.WriteLine(Status);
}catch(Exception ex){Status="WINDOWS SPEECH ERROR: "+ex.Message;engine?.Dispose();engine=null;throw;}return Task.CompletedTask;}
public Task Stop(){running=false;try{engine?.RecognizeAsyncCancel();engine?.RecognizeAsyncStop();engine?.Dispose();}catch{}engine=null;Status="Recognition stopped.";return Task.CompletedTask;}
public string TakeTranscript(){lock(gate){var s=output.ToString();output.Clear();return s;}}
}
