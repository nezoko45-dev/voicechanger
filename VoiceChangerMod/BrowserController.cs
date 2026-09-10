using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using MelonLoader;

namespace VoiceChangerMod;

internal static class BrowserController
{
    private static readonly string[] AllowedFiles = { "index.html", "app.js", "style.css" };
    private static readonly HttpClient Http = new HttpClient();
    private static HttpListener? _server;
    private static Thread? _serverThread;
    private static int _port;

    public static void Start()
    {
        try
        {
            StartServer();
            if (_port != 0) MelonLogger.Msg("Cartesia browser voice changer ready. Press F8 to open the control panel.");
        }
        catch (Exception ex) { MelonLogger.Error("VoiceChanger startup failed: " + ex); }
    }

    public static void Update()
    {
        if ((GetAsyncKeyState(0x77) & 1) != 0) OpenBrowser();
    }

    private static void OpenBrowser()
    {
        if (_port == 0) { MelonLogger.Error("VoiceChanger browser control panel is not running; no local port is available."); return; }
        try
        {
            Process.Start(new ProcessStartInfo { FileName = "http://127.0.0.1:" + _port + "/", UseShellExecute = true });
            MelonLogger.Msg("Opened VoiceChanger control panel at http://127.0.0.1:" + _port + "/");
        }
        catch (Exception ex) { MelonLogger.Error("Could not open browser: " + ex); }
    }

    private static void StartServer()
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string[] roots =
        {
            Path.Combine(baseDir, "BrowserVoiceChanger"),
            Path.Combine(baseDir, "Mods", "BrowserVoiceChanger"),
            Path.Combine(Path.GetDirectoryName(typeof(BrowserController).Assembly.Location) ?? baseDir, "BrowserVoiceChanger")
        };
        string? root = null;
        foreach (string candidate in roots)
            if (File.Exists(Path.Combine(candidate, "index.html"))) { root = candidate; break; }
        if (root == null) { MelonLogger.Error("BrowserVoiceChanger files were not installed with the mod."); return; }

        for (int port = 17845; port <= 17855; port++)
        {
            HttpListener? listener = null;
            try
            {
                listener = new HttpListener();
                listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
                listener.Start();
                _server = listener; _port = port;
                _serverThread = new Thread(() => ServeLoop(root)) { IsBackground = true, Name = "VoiceChanger Browser Server" };
                _serverThread.Start();
                MelonLogger.Msg("Browser UI hosted at http://127.0.0.1:" + port + "/");
                return;
            }
            catch (Exception ex) { try { listener?.Close(); } catch { } MelonLogger.Msg("Port " + port + " unavailable: " + ex.Message); }
        }
        MelonLogger.Error("Could not find a free local browser port from 17845-17855.");
    }

    private static void ServeLoop(string root)
    {
        while (_server != null)
        {
            HttpListenerContext? context = null;
            try { context = _server.GetContext(); } catch { break; }
            if (context == null) continue;
            string requested = context.Request.Url?.AbsolutePath?.TrimStart('/') ?? "";
            if (string.IsNullOrEmpty(requested)) requested = "index.html";

            if (requested.Equals("cartesia-stt", StringComparison.OrdinalIgnoreCase)) { HandleCartesiaStt(context); continue; }
            if (requested.Equals("cartesia-tts", StringComparison.OrdinalIgnoreCase)) { HandleCartesiaTts(context); continue; }

            if (requested.IndexOf("..", StringComparison.Ordinal) >= 0 || Array.IndexOf(AllowedFiles, requested) < 0)
            { context.Response.StatusCode = 404; context.Response.Close(); continue; }

            string file = Path.Combine(root, requested);
            try
            {
                byte[] data = File.ReadAllBytes(file);
                context.Response.ContentType = requested.EndsWith(".html", StringComparison.OrdinalIgnoreCase) ? "text/html; charset=utf-8" : requested.EndsWith(".css", StringComparison.OrdinalIgnoreCase) ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
                context.Response.ContentLength64 = data.Length;
                context.Response.Headers["Cache-Control"] = "no-store";
                context.Response.OutputStream.Write(data, 0, data.Length);
            }
            catch (Exception ex) { MelonLogger.Error("Browser file request failed: " + ex); context.Response.StatusCode = 500; }
            finally { try { context.Response.OutputStream.Close(); } catch { } }
        }
    }

    private static string ReadBody(HttpListenerContext context)
    {
        using var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding ?? Encoding.UTF8);
        return reader.ReadToEnd();
    }

    private static string JsonValue(string body, string name)
    {
        Match match = Regex.Match(body, "\\\"" + Regex.Escape(name) + "\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"", RegexOptions.CultureInvariant);
        return match.Success ? match.Groups[1].Value : "";
    }

    private static void HandleCartesiaStt(HttpListenerContext context)
    {
        try
        {
            if (!string.Equals(context.Request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase)) { WriteJson(context, 405, "{\"error\":\"POST required.\"}"); return; }
            string body = ReadBody(context);
            string apiKey = JsonValue(body, "apiKey");
            string audioBase64 = JsonValue(body, "audioBase64");
            if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(audioBase64)) { WriteJson(context, 400, "{\"error\":\"API key and audio are required.\"}"); return; }

            byte[] audio = Convert.FromBase64String(audioBase64);
            using var form = new MultipartFormDataContent();
            var file = new ByteArrayContent(audio);
            file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/wav");
            form.Add(file, "file", "voice.wav");
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.cartesia.ai/stt");
            request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + apiKey);
            request.Headers.TryAddWithoutValidation("Cartesia-Version", "2026-03-01");
            request.Content = form;
            using HttpResponseMessage response = Http.SendAsync(request).GetAwaiter().GetResult();
            string result = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            if (!response.IsSuccessStatusCode) { WriteJson(context, (int)response.StatusCode, "{\"error\":\"Cartesia STT HTTP " + (int)response.StatusCode + ": " + EscapeJson(result) + "\"}"); return; }
            WriteJson(context, 200, result);
        }
        catch (Exception ex) { MelonLogger.Error("Cartesia STT bridge failed: " + ex); WriteJson(context, 500, "{\"error\":\"" + EscapeJson(ex.Message) + "\"}"); }
    }

    private static void HandleCartesiaTts(HttpListenerContext context)
    {
        try
        {
            if (!string.Equals(context.Request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase)) { WriteJson(context, 405, "{\"error\":\"POST required.\"}"); return; }
            string body = ReadBody(context);
            string apiKey = JsonValue(body, "apiKey");
            string voiceId = JsonValue(body, "voiceId");
            string transcript = JsonValue(body, "transcript");
            if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(voiceId) || string.IsNullOrWhiteSpace(transcript)) { WriteJson(context, 400, "{\"error\":\"API key, voice ID and transcript are required.\"}"); return; }

            string payload = "{\"model_id\":\"sonic-3.5\",\"transcript\":\"" + EscapeJson(transcript) + "\",\"voice\":{\"mode\":\"id\",\"id\":\"" + EscapeJson(voiceId) + "\"},\"language\":\"en\",\"output_format\":{\"container\":\"wav\",\"encoding\":\"pcm_s16le\",\"sample_rate\":48000},\"generation_config\":{\"volume\":1,\"speed\":1}}";
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.cartesia.ai/tts/bytes");
            request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + apiKey);
            request.Headers.TryAddWithoutValidation("Cartesia-Version", "2026-03-01");
            request.Content = new StringContent(payload, Encoding.UTF8, "application/json");
            using HttpResponseMessage response = Http.SendAsync(request).GetAwaiter().GetResult();
            byte[] audio = response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult();
            if (!response.IsSuccessStatusCode) { string detail = Encoding.UTF8.GetString(audio); WriteJson(context, (int)response.StatusCode, "{\"error\":\"Cartesia TTS HTTP " + (int)response.StatusCode + ": " + EscapeJson(detail) + "\"}"); return; }
            context.Response.StatusCode = 200;
            context.Response.ContentType = "audio/wav";
            context.Response.ContentLength64 = audio.Length;
            context.Response.Headers["Cache-Control"] = "no-store";
            context.Response.OutputStream.Write(audio, 0, audio.Length);
            context.Response.OutputStream.Close();
        }
        catch (Exception ex) { MelonLogger.Error("Cartesia TTS bridge failed: " + ex); WriteJson(context, 500, "{\"error\":\"" + EscapeJson(ex.Message) + "\"}"); }
    }

    private static string EscapeJson(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");

    private static void WriteJson(HttpListenerContext context, int statusCode, string json)
    {
        byte[] data = Encoding.UTF8.GetBytes(json);
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.ContentLength64 = data.Length;
        context.Response.Headers["Cache-Control"] = "no-store";
        try { context.Response.OutputStream.Write(data, 0, data.Length); } finally { try { context.Response.OutputStream.Close(); } catch { } }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);
}
