using System.Net;
using System.Text;
using System.Text.Json;

var root = AppContext.BaseDirectory;
var engine = new AudioEngine(root);
using var listener = new HttpListener();
listener.Prefixes.Add("http://127.0.0.1:8765/");
listener.Start();

Console.Title = "VoiceChanger Audio Engine";
Console.WriteLine("VoiceChanger.exe");
Console.WriteLine("Control page: http://127.0.0.1:8765");
Console.WriteLine("Audio stays inside the EXE: microphone -> OpenVoice/ONNX -> output.");

Console.CancelKeyPress += (_, e) => { e.Cancel = true; engine.Stop(); };

while (listener.IsListening)
{
    HttpListenerContext ctx;
    try { ctx = await listener.GetContextAsync(); }
    catch { break; }
    _ = Task.Run(() => Handle(ctx));
}

async Task Handle(HttpListenerContext ctx)
{
    try
    {
        var req = ctx.Request;
        var path = req.Url?.AbsolutePath ?? "/";
        ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
        ctx.Response.Headers["Access-Control-Allow-Headers"] = "content-type";

        if (req.HttpMethod == "OPTIONS") { ctx.Response.StatusCode = 204; ctx.Response.Close(); return; }

        if (path == "/health" && req.HttpMethod == "GET")
        {
            await Json(ctx, 200, engine.Status());
            return;
        }

        if (path == "/devices" && req.HttpMethod == "GET")
        {
            await Json(ctx, 200, new { ok = true, devices = engine.GetDevices(), voicemeeterId = engine.FindVoicemeeter() });
            return;
        }

        if (path == "/target" && req.HttpMethod == "POST")
        {
            var body = await ReadJson(ctx);
            var wav = body.TryGetProperty("wav", out var w) ? w.GetString() : null;
            if (string.IsNullOrWhiteSpace(wav)) throw new Exception("No WAV data was provided.");
            await engine.SetTargetAsync(Convert.FromBase64String(wav));
            await Json(ctx, 200, new { ok = true });
            return;
        }

        if (path == "/start" && req.HttpMethod == "POST")
        {
            var body = await ReadJson(ctx);
            int? inputId = body.TryGetProperty("inputId", out var i) && i.ValueKind != JsonValueKind.Null ? i.GetInt32() : null;
            int? outputId = body.TryGetProperty("outputId", out var o) && o.ValueKind != JsonValueKind.Null ? o.GetInt32() : null;
            await engine.StartAsync(inputId, outputId);
            await Json(ctx, 200, new { ok = true });
            return;
        }

        if (path == "/stop" && req.HttpMethod == "POST")
        {
            engine.Stop();
            await Json(ctx, 200, new { ok = true });
            return;
        }

        if (req.HttpMethod == "GET")
        {
            var relative = path == "/" ? "index.html" : path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            var file = Path.GetFullPath(Path.Combine(root, "wwwroot", relative));
            var webroot = Path.GetFullPath(Path.Combine(root, "wwwroot")) + Path.DirectorySeparatorChar;
            if (file.StartsWith(webroot, StringComparison.OrdinalIgnoreCase) && File.Exists(file))
            {
                var ext = Path.GetExtension(file).ToLowerInvariant();
                ctx.Response.ContentType = ext switch
                {
                    ".html" => "text/html; charset=utf-8",
                    ".js" => "text/javascript; charset=utf-8",
                    ".css" => "text/css; charset=utf-8",
                    ".json" => "application/json; charset=utf-8",
                    _ => "application/octet-stream"
                };
                var data = await File.ReadAllBytesAsync(file);
                ctx.Response.ContentLength64 = data.Length;
                await ctx.Response.OutputStream.WriteAsync(data);
                ctx.Response.Close();
                return;
            }
        }

        await Json(ctx, 404, new { ok = false, error = "Not found" });
    }
    catch (Exception ex)
    {
        Console.WriteLine("[ERROR] " + ex.Message);
        try { await Json(ctx, 500, new { ok = false, error = ex.Message }); } catch { }
    }
}

static async Task<JsonElement> ReadJson(HttpListenerContext ctx)
{
    using var sr = new StreamReader(ctx.Request.InputStream, Encoding.UTF8);
    using var doc = JsonDocument.Parse(await sr.ReadToEndAsync());
    return doc.RootElement.Clone();
}

static async Task Json(HttpListenerContext ctx, int status, object value)
{
    var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value));
    ctx.Response.StatusCode = status;
    ctx.Response.ContentType = "application/json; charset=utf-8";
    ctx.Response.ContentLength64 = bytes.Length;
    await ctx.Response.OutputStream.WriteAsync(bytes);
    ctx.Response.Close();
}
