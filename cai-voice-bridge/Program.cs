using System.Diagnostics;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

const int DebugPort = 9222;
const int LocalPort = 8765;
const string DebugEndpoint = "http://127.0.0.1:9222/json";
using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
Console.Title = "Character.AI Voice Bridge";
Console.WriteLine("Character.AI Voice Bridge — Chrome speech recognition + paste bridge");
int commandId = 0;
ClientWebSocket? caiSocket = null;
JsonElement caiTarget = default;

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
        Console.WriteLine("Connected to Character.AI tab. Speech will be pasted into its message box.");
    }
    catch (Exception ex) { Console.WriteLine($"CDP reconnect: {ex.Message}"); EnsureDebugBrowser(); }
    await Task.Delay(1500);
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
                if (ctx.Request.HttpMethod == "GET")
                {
                    var html = SpeechPage;
                    ctx.Response.ContentType = "text/html; charset=utf-8";
                    var bytes = Encoding.UTF8.GetBytes(html);
                    await ctx.Response.OutputStream.WriteAsync(bytes);
                }
                else if (ctx.Request.HttpMethod == "POST" && ctx.Request.Url?.AbsolutePath == "/speech")
                {
                    using var reader = new StreamReader(ctx.Request.InputStream, ctx.Request.ContentEncoding);
                    var transcript = (await reader.ReadToEndAsync()).Trim();
                    if (transcript.Length > 0) await PasteIntoCai(transcript);
                    ctx.Response.StatusCode = 204;
                }
                else ctx.Response.StatusCode = 404;
            }
            catch (Exception e) { Console.WriteLine("Local speech request: " + e.Message); ctx.Response.StatusCode = 500; }
            finally { ctx.Response.Close(); }
        });
    }
}

async Task PasteIntoCai(string words)
{
    var ws = caiSocket;
    if (ws?.State != WebSocketState.Open) { Console.WriteLine("Transcript received but Character.AI is not connected: " + words); return; }
    // Paste into the composer without sending. Preserve existing text by appending.
    var js = @"(()=>{const e=document.querySelector('[contenteditable=true][data-placeholder],textarea')||document.querySelector('[contenteditable=true]');if(!e)return 'COMPOSER_NOT_FOUND';e.focus();const t=" + JsonSerializer.Serialize(words) + @";if(e.tagName==='TEXTAREA'){const s=e.value;const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(e,(s?s+' ':'')+t);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t}));}else{document.execCommand('insertText',false,(e.innerText?' ':'')+t);}return 'PASTED: '+t})()";
    var payload = JsonSerializer.Serialize(new { id = ++commandId, method = "Runtime.evaluate", @params = new { expression = js, returnByValue = true } });
    await ws.SendAsync(Encoding.UTF8.GetBytes(payload), WebSocketMessageType.Text, true, CancellationToken.None);
    Console.WriteLine("Speech → Character.AI: " + words);
}

void OpenSpeechPage()
{
    var browser = FindChrome();
    if (browser is null) return;
    var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CAIVoiceBridge", "ChromeProfile");
    Process.Start(new ProcessStartInfo { FileName = browser, Arguments = $"--remote-debugging-port={DebugPort} --user-data-dir=\\\"{profile}\\\" http://127.0.0.1:{LocalPort}/", UseShellExecute = true });
}

void EnsureDebugBrowser()
{
    try { using var check = new HttpClient { Timeout = TimeSpan.FromSeconds(1) }; check.GetAsync(DebugEndpoint).GetAwaiter().GetResult(); return; } catch { }
    var browser = FindChrome();
    if (browser is null) { Console.WriteLine("Chrome not found. Install Google Chrome and restart."); return; }
    var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CAIVoiceBridge", "ChromeProfile");
    Directory.CreateDirectory(profile);
    Console.WriteLine("Starting dedicated Chrome automatically...");
    Process.Start(new ProcessStartInfo { FileName = browser, Arguments = $"--remote-debugging-port={DebugPort} --user-data-dir=\"{profile}\" https://character.ai", UseShellExecute = true });
}
string? FindChrome()
{
    var paths = new[] {
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe")
    };
    return paths.FirstOrDefault(File.Exists);
}

const string SpeechPage = """
<!doctype html><html><head><meta charset="utf-8"><title>CAI Speech Bridge</title>
<style>body{font:16px system-ui;background:#17171b;color:#eee;max-width:600px;margin:40px auto;padding:20px}button{font-size:18px;padding:12px 20px}#status{color:#9f9;margin:15px 0}#heard{white-space:pre-wrap;background:#24242a;padding:12px;border-radius:8px;min-height:70px}</style></head>
<body><h2>Character.AI Speech Bridge</h2><button id="toggle">Start Chrome Speech Recognition</button><div id="status">Idle — click Start and allow microphone</div><h3>Recognized words</h3><div id="heard"></div>
<script>
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null,enabled=false,speaking=false,idleTimer=null;
const status=document.querySelector('#status'),heard=document.querySelector('#heard'),btn=document.querySelector('#toggle');
function idle(){clearTimeout(idleTimer);if(!speaking&&enabled){status.textContent='Idle — listening';idleTimer=setTimeout(()=>{if(!speaking)status.textContent='Idle — listening (timer resumed)'},5000)}}
function start(){if(!enabled||!SR)return;rec=new SR();rec.continuous=true;rec.interimResults=false;rec.lang='en-US';
rec.onstart=()=>{status.textContent='Listening…';idle()};
rec.onspeechstart=()=>{speaking=true;clearTimeout(idleTimer);status.textContent='Speaking — idle timer PAUSED'};
rec.onspeechend=()=>{speaking=false;status.textContent='Speech ended — returning to idle';idle()};
rec.onresult=async e=>{let text='';for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)text+=e.results[i][0].transcript;
text=text.trim();if(!text)return;heard.textContent+=(heard.textContent?'\n':'')+text;status.textContent='Pasting recognized speech…';try{await fetch('/speech',{method:'POST',headers:{'Content-Type':'text/plain'},body:text});status.textContent=speaking?'Speaking — idle timer PAUSED':'Pasted — idle';}catch(err){status.textContent='Local bridge error: '+err;}};
rec.onerror=e=>{status.textContent='Recognition: '+e.error};rec.onend=()=>{if(enabled)setTimeout(start,300)};try{rec.start()}catch{}}
btn.onclick=()=>{enabled=!enabled;btn.textContent=enabled?'Stop Recognition':'Start Chrome Speech Recognition';if(enabled)start();else{clearTimeout(idleTimer);rec?.stop();status.textContent='Stopped'}};
if(!SR){btn.disabled=true;status.textContent='Chrome SpeechRecognition is unavailable';}
</script></body></html>
""";
