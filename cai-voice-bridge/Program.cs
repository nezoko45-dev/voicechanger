using System.Diagnostics;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

const string SpeechPage = """
<!doctype html><html><head><meta charset="utf-8"><title>CAI Speech Bridge</title>
<style>body{font:16px system-ui;background:#17171b;color:#eee;max-width:600px;margin:40px auto;padding:20px}button{font-size:18px;padding:12px 20px}#status{color:#9f9;margin:15px 0}#heard{white-space:pre-wrap;background:#24242a;padding:12px;border-radius:8px;min-height:70px}</style></head>
<body><h2>Character.AI Speech Bridge</h2><button id="toggle">Start Chrome Speech Recognition</button><div id="status">Idle — click Start and allow microphone</div><h3>Recognized words</h3><div id="heard"></div>
<script>
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null,enabled=false,speaking=false,idleTimer=null,finalText='';
const status=document.querySelector('#status'),heard=document.querySelector('#heard'),btn=document.querySelector('#toggle');
function idle(){clearTimeout(idleTimer);if(!speaking&&enabled){status.textContent='Listening…';idleTimer=setTimeout(()=>{if(!speaking)status.textContent='Listening… (mic active)'},5000)}}
async function pollStatus(){try{const x=await fetch('/status.txt');const s=await x.text();if(s)status.textContent=s;}catch{}}
setInterval(pollStatus,1000);
function start(){
 if(!enabled)return;
 if(!SR){status.textContent='ERROR: Chrome SpeechRecognition unavailable';return;}
 rec=new SR();rec.continuous=true;rec.interimResults=true;rec.lang='en-US';
 rec.onstart=()=>{status.textContent='MIC ACTIVE — listening';idle()};
 rec.onaudiostart=()=>{status.textContent='Microphone audio received…'};
 rec.onspeechstart=()=>{speaking=true;clearTimeout(idleTimer);status.textContent='Speech detected…'};
 rec.onspeechend=()=>{speaking=false;status.textContent='Speech ended — finalizing words…';idle()};
 rec.onresult=async e=>{
  let interim='',final='';
  for(let i=e.resultIndex;i<e.results.length;i++){const phrase=e.results[i][0].transcript;if(e.results[i].isFinal)final+=phrase;else interim+=phrase;}
  if(interim)heard.textContent=finalText+' '+interim;
  if(final.trim()){finalText+=(finalText?' ':'')+final.trim();heard.textContent=finalText;status.textContent='Recognized: '+final.trim()+' — sending…';
   try{const r=await fetch('/speech',{method:'POST',headers:{'Content-Type':'text/plain'},body:final.trim()});if(!r.ok)throw Error('HTTP '+r.status);status.textContent='Sent to Character.AI — waiting for reply';}
   catch(err){status.textContent='Bridge error: '+err.message;}
  }
 };
 rec.onerror=e=>{status.textContent='Speech recognition ERROR: '+e.error+(e.message?' / '+e.message:'');};
 rec.onend=()=>{if(enabled){status.textContent='Recognition restarting…';setTimeout(()=>{if(enabled)start()},500)}};
 try{rec.start();status.textContent='Starting microphone…';}catch(err){status.textContent='Could not start recognition: '+err.message;}
}
btn.onclick=()=>{enabled=!enabled;btn.textContent=enabled?'Stop Recognition':'Start Chrome Speech Recognition';if(enabled){finalText='';heard.textContent='';start()}else{clearTimeout(idleTimer);rec?.stop();status.textContent='Stopped'}};
if(!SR){btn.disabled=true;status.textContent='ERROR: Chrome SpeechRecognition unavailable';}
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
