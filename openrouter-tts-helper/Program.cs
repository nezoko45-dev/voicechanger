using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

const string Prefix = "http://127.0.0.1:32146/";
const string AllowedOrigin = "https://nezoko45-dev.github.io";
const string SpeechEndpoint = "https://openrouter.ai/api/v1/audio/speech";

Console.Title = "OpenRouter TTS Helper";
Console.WriteLine("OpenRouter TTS Reader — local Windows helper");
Console.WriteLine("Listens only on this PC at 127.0.0.1:32146.");
Console.WriteLine("Your OpenRouter API key is held in memory and is not saved to disk.");
Console.WriteLine("Reader tip: copy a ChatGPT reply, then use Paste from Clipboard or Ctrl+V on the reader page.");
Console.Write("Paste OpenRouter API key (input hidden): ");
var keyBuilder = new StringBuilder();
while (true)
{
    var k = Console.ReadKey(intercept: true);
    if (k.Key == ConsoleKey.Enter) break;
    if (k.Key == ConsoleKey.Backspace) { if (keyBuilder.Length > 0) keyBuilder.Length--; continue; }
    if (!char.IsControl(k.KeyChar)) keyBuilder.Append(k.KeyChar);
}
var apiKey = keyBuilder.ToString().Trim();
Console.WriteLine();
if (!apiKey.StartsWith("sk-or-", StringComparison.Ordinal) || apiKey.Length < 20)
{
    Console.WriteLine("That does not look like an OpenRouter API key. Close this window and try again.");
    Console.WriteLine("Press Enter to exit."); Console.ReadLine(); return;
}

using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
using var listener = new HttpListener();
listener.Prefixes.Add(Prefix);
try { listener.Start(); }
catch (HttpListenerException ex)
{
    Console.WriteLine($"Could not start local listener: {ex.Message}");
    Console.WriteLine("Port 32146 may already be in use. Close any previous helper and retry.");
    Console.ReadLine(); return;
}
Console.WriteLine();
Console.WriteLine($"Ready at {Prefix}api/speech");
Console.WriteLine("Keep this window open while reading. Press Ctrl+C to stop.");
while (listener.IsListening)
{
    HttpListenerContext context;
    try { context = await listener.GetContextAsync(); }
    catch (HttpListenerException) { break; }
    catch (ObjectDisposedException) { break; }
    _ = HandleAsync(context, client, apiKey);
}

static async Task HandleAsync(HttpListenerContext context, HttpClient client, string apiKey)
{
    var req = context.Request;
    var res = context.Response;
    res.Headers["Cache-Control"] = "no-store";
    res.Headers["X-Content-Type-Options"] = "nosniff";
    var origin = req.Headers["Origin"] ?? "";
    if (origin != AllowedOrigin && origin != "http://127.0.0.1:32146" && origin != "http://localhost:32146")
    {
        await JsonAsync(res, 403, new { error = "This helper only accepts requests from the official voice reader page." });
        return;
    }
    res.Headers["Access-Control-Allow-Origin"] = origin;
    res.Headers["Vary"] = "Origin";
    res.Headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    res.Headers["Access-Control-Allow-Headers"] = "Content-Type";
    res.Headers["Access-Control-Max-Age"] = "600";
    if (req.HttpMethod == "OPTIONS") { res.StatusCode = 204; res.Close(); return; }
    if (req.HttpMethod != "POST" || req.Url?.AbsolutePath != "/api/speech")
    {
        await JsonAsync(res, 404, new { error = "Use POST /api/speech." }); return;
    }
    try
    {
        using var body = new MemoryStream();
        await req.InputStream.CopyToAsync(body);
        if (body.Length > 1_000_000) { await JsonAsync(res, 413, new { error = "Text request is too large." }); return; }
        using var doc = JsonDocument.Parse(body.ToArray());
        var root = doc.RootElement;
        string Get(string name) => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        var model = Get("model");
        var input = Get("input");
        var voice = Get("voice");
        var format = Get("response_format");
        if (string.IsNullOrWhiteSpace(input)) { await JsonAsync(res, 400, new { error = "Text input is required." }); return; }
        if (input.Length > 20000) { await JsonAsync(res, 413, new { error = "Text is too long. Please split it into shorter replies." }); return; }
        var allowedModels = new[] { "x-ai/grok-voice-tts-1.0", "mistralai/voxtral-mini-tts-2603", "microsoft/mai-voice-2" };
        if (!allowedModels.Contains(model)) { await JsonAsync(res, 400, new { error = "Unsupported model selection." }); return; }
        if (string.IsNullOrWhiteSpace(voice)) { await JsonAsync(res, 400, new { error = "Voice is required." }); return; }
        var payload = JsonSerializer.Serialize(new { model, input, voice, response_format = string.IsNullOrWhiteSpace(format) ? "mp3" : format });
        using var upstream = new HttpRequestMessage(HttpMethod.Post, SpeechEndpoint);
        upstream.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        upstream.Headers.TryAddWithoutValidation("HTTP-Referer", AllowedOrigin);
        upstream.Headers.TryAddWithoutValidation("X-OpenRouter-Title", "OpenRouter TTS Reader");
        upstream.Content = new StringContent(payload, Encoding.UTF8, "application/json");
        using var response = await client.SendAsync(upstream, HttpCompletionOption.ResponseHeadersRead);
        if (!response.IsSuccessStatusCode)
        {
            var detail = await response.Content.ReadAsStringAsync();
            string message = detail.Length > 1000 ? detail[..1000] : detail;
            try { using var err = JsonDocument.Parse(detail); if (err.RootElement.TryGetProperty("error", out var e)) message = e.ValueKind == JsonValueKind.Object && e.TryGetProperty("message", out var m) ? m.GetString() ?? message : e.ToString(); } catch { }
            await JsonAsync(res, (int)response.StatusCode, new { error = message }); return;
        }
        var audio = await response.Content.ReadAsByteArrayAsync();
        if (audio.Length == 0) { await JsonAsync(res, 502, new { error = "OpenRouter returned an empty audio response." }); return; }
        res.StatusCode = 200;
        res.ContentType = response.Content.Headers.ContentType?.MediaType?.StartsWith("audio/") == true ? response.Content.Headers.ContentType.MediaType : "audio/mpeg";
        res.ContentLength64 = audio.Length;
        await res.OutputStream.WriteAsync(audio);
        res.Close();
    }
    catch (JsonException) { await JsonAsync(res, 400, new { error = "Invalid JSON request." }); }
    catch (TaskCanceledException) { await JsonAsync(res, 504, new { error = "OpenRouter request timed out." }); }
    catch (Exception ex)
    {
        Console.WriteLine($"Request failed: {ex.Message}");
        await JsonAsync(res, 500, new { error = "Could not generate audio. Check the helper console for details." });
    }
}
static async Task JsonAsync(HttpListenerResponse res, int status, object body)
{
    try
    {
        res.StatusCode = status; res.ContentType = "application/json; charset=utf-8";
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(body));
        res.ContentLength64 = bytes.Length; await res.OutputStream.WriteAsync(bytes);
    }
    catch { }
    finally { try { res.Close(); } catch { } }
}
