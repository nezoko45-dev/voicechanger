using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using NAudio.Wave;

const string Prefix = "http://127.0.0.1:32146/";
const string AllowedOrigin = "https://nezoko45-dev.github.io";
const string PageUrl = "https://nezoko45-dev.github.io/voicechanger/openrouter-tts-reader/";
const string SpeechEndpoint = "https://openrouter.ai/api/v1/audio/speech";

Console.Title = "OpenRouter TTS Helper";
Console.WriteLine("OpenRouter TTS Helper — Chrome dictation + audio page");
Console.WriteLine("The helper serves speech requests locally; The EXE plays audio directly through the selected Windows output device; Chrome handles dictation and controls.");
Console.WriteLine("Your OpenRouter API key stays in memory and is not saved to disk.");
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
    Console.WriteLine("Press Enter to exit.");
    Console.ReadLine();
    return;
}

using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
using var listener = new HttpListener();
listener.Prefixes.Add(Prefix);
try { listener.Start(); }
catch (HttpListenerException ex)
{
    Console.WriteLine($"Could not start local listener: {ex.Message}");
    Console.WriteLine("Port 32146 may already be in use. Close any previous helper and retry.");
    Console.ReadLine();
    return;
}
Console.WriteLine();
Console.WriteLine($"Ready at {Prefix}api/speech");
Console.WriteLine("Opening the reader page in Chrome. Keep this window open while using dictation.");
OpenChrome(PageUrl);
var audioPlayer = new LocalAudioPlayer();
while (listener.IsListening)
{
    HttpListenerContext context;
    try { context = await listener.GetContextAsync(); }
    catch (HttpListenerException) { break; }
    catch (ObjectDisposedException) { break; }
    _ = HandleAsync(context, client, apiKey, audioPlayer);
}

static void OpenChrome(string url)
{
    try
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe")
        };
        var chrome = candidates.FirstOrDefault(File.Exists);
        if (chrome is not null) Process.Start(new ProcessStartInfo(chrome, url) { UseShellExecute = false });
        else Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Could not open Chrome automatically: {ex.Message}");
        Console.WriteLine("Open this URL manually: " + url);
    }
}

static async Task HandleAsync(HttpListenerContext context, HttpClient client, string apiKey, LocalAudioPlayer audioPlayer)
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
    res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    res.Headers["Access-Control-Allow-Headers"] = "Content-Type";
    res.Headers["Access-Control-Max-Age"] = "600";
    if (req.HttpMethod == "OPTIONS") { res.StatusCode = 204; res.Close(); return; }
    var path = req.Url?.AbsolutePath ?? "/";
    if (req.HttpMethod == "GET" && path == "/api/devices") { var devices = Enumerable.Range(0, WaveOut.DeviceCount).Select(i => new { deviceNumber = i, name = WaveOut.GetCapabilities(i).ProductName }).ToArray(); await JsonAsync(res, 200, new { devices, playing = audioPlayer.IsPlaying }); return; }
    if (req.HttpMethod == "GET" && path == "/api/status") { await JsonAsync(res, 200, new { playing = audioPlayer.IsPlaying }); return; }
    if (req.HttpMethod == "POST" && path == "/api/stop") { audioPlayer.Stop(); await JsonAsync(res, 200, new { ok = true, playing = false }); return; }
    if (req.HttpMethod != "POST" || path != "/api/speech")
    {
        await JsonAsync(res, 404, new { error = "Use POST /api/speech." });
        return;
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
        int deviceNumber = root.TryGetProperty("deviceNumber", out var dv) && dv.TryGetInt32(out var dn) ? dn : -1;
        if (string.IsNullOrWhiteSpace(input)) { await JsonAsync(res, 400, new { error = "Text input is required." }); return; }
        if (input.Length > 20000) { await JsonAsync(res, 413, new { error = "Text is too long. Please split it into shorter phrases." }); return; }
        var allowedModels = new[] { "x-ai/grok-voice-tts-1.0", "mistralai/voxtral-mini-tts-2603", "microsoft/mai-voice-2" };
        if (!allowedModels.Contains(model)) { await JsonAsync(res, 400, new { error = "Unsupported model selection." }); return; }
        if (string.IsNullOrWhiteSpace(voice)) { await JsonAsync(res, 400, new { error = "Voice is required." }); return; }
        if (deviceNumber < 0 || deviceNumber >= WaveOut.DeviceCount) { await JsonAsync(res, 400, new { error = "Choose a valid Windows audio output device." }); return; }
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
            await JsonAsync(res, (int)response.StatusCode, new { error = message });
            return;
        }
        var audio = await response.Content.ReadAsByteArrayAsync();
        if (audio.Length == 0) { await JsonAsync(res, 502, new { error = "OpenRouter returned an empty audio response." }); return; }
        audioPlayer.PlayMp3(audio, deviceNumber);
        await JsonAsync(res, 200, new { ok = true, playing = true, deviceNumber });
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
        res.StatusCode = status;
        res.ContentType = "application/json; charset=utf-8";
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(body));
        res.ContentLength64 = bytes.Length;
        await res.OutputStream.WriteAsync(bytes);
    }
    catch { }
    finally { try { res.Close(); } catch { } }
}


sealed class LocalAudioPlayer
{
 private readonly object gate = new(); private WaveOutEvent? output; private Mp3FileReader? reader; private MemoryStream? stream;
 public bool IsPlaying { get { lock (gate) return output is not null; } }
 public void PlayMp3(byte[] bytes, int deviceNumber) { Stop(); var ms = new MemoryStream(bytes, false); Mp3FileReader? r = null; WaveOutEvent? o = null; try { r = new Mp3FileReader(ms); o = new WaveOutEvent { DeviceNumber = deviceNumber }; o.Init(r); o.PlaybackStopped += (_, _) => Cleanup(o, r, ms); lock (gate) { stream = ms; reader = r; output = o; } o.Play(); } catch { o?.Dispose(); r?.Dispose(); ms.Dispose(); throw; } }
 public void Stop() { WaveOutEvent? o; lock (gate) o = output; if (o is null) return; try { o.Stop(); } catch { CleanupCurrent(); } }
 private void Cleanup(WaveOutEvent o, Mp3FileReader r, MemoryStream ms) { lock (gate) { if (ReferenceEquals(output, o)) { output = null; reader = null; stream = null; } } o.Dispose(); r.Dispose(); ms.Dispose(); }
 private void CleanupCurrent() { WaveOutEvent? o; Mp3FileReader? r; MemoryStream? ms; lock (gate) { o=output; r=reader; ms=stream; output=null; reader=null; stream=null; } o?.Dispose(); r?.Dispose(); ms?.Dispose(); }
}
