using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

const string Prefix = "http://127.0.0.1:32145/";
const string AllowedPagesOrigin = "https://nezoko45-dev.github.io";
const string OpenAiEndpoint = "https://api.openai.com/v1/realtime/client_secrets";

Console.Title = "Voice Reader Local Token Helper";
Console.WriteLine("OpenAI Realtime Voice Reader — local token helper");
Console.WriteLine("This helper listens only on 127.0.0.1 (your own PC).");
Console.WriteLine("Your OpenAI API key stays in this process memory and is not saved to disk.");
Console.Write("Paste your OpenAI API key (input is visible): ");
var apiKey = Console.ReadLine()?.Trim() ?? "";
if (!apiKey.StartsWith("sk-", StringComparison.Ordinal) || apiKey.Length < 20)
{
    Console.WriteLine("That does not look like a valid OpenAI API key. Close this window and try again.");
    Console.WriteLine("Press Enter to exit.");
    Console.ReadLine();
    return;
}

using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
using var listener = new HttpListener();
listener.Prefixes.Add(Prefix);

try
{
    listener.Start();
}
catch (HttpListenerException ex)
{
    Console.WriteLine($"Could not start local listener: {ex.Message}");
    Console.WriteLine("Port 32145 may already be in use. Close any previous helper and try again.");
    Console.ReadLine();
    return;
}

Console.WriteLine();
Console.WriteLine($"Ready at {Prefix}api/session");
Console.WriteLine("Keep this window open while using the voice reader. Press Ctrl+C to stop.");
Console.WriteLine();

while (listener.IsListening)
{
    HttpListenerContext context;
    try { context = await listener.GetContextAsync(); }
    catch (HttpListenerException) { break; }
    catch (ObjectDisposedException) { break; }

    _ = HandleRequestAsync(context, client, apiKey, AllowedPagesOrigin, OpenAiEndpoint);
}

static async Task HandleRequestAsync(HttpListenerContext context, HttpClient client, string apiKey, string allowedOrigin, string openAiEndpoint)
{
    var req = context.Request;
    var res = context.Response;
    res.Headers["Cache-Control"] = "no-store";
    res.Headers["X-Content-Type-Options"] = "nosniff";

    var origin = req.Headers["Origin"] ?? "";
    if (origin != allowedOrigin && origin != "http://127.0.0.1:32145" && origin != "http://localhost:32145")
    {
        await WriteJsonAsync(res, 403, new { error = "This local helper only accepts requests from the voice-reader page." });
        return;
    }

    res.Headers["Access-Control-Allow-Origin"] = origin;
    res.Headers["Vary"] = "Origin";
    res.Headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    res.Headers["Access-Control-Allow-Headers"] = "Content-Type";
    res.Headers["Access-Control-Max-Age"] = "600";

    if (req.HttpMethod == "OPTIONS")
    {
        res.StatusCode = 204;
        res.Close();
        return;
    }

    if (req.HttpMethod != "POST" || req.Url?.AbsolutePath != "/api/session")
    {
        await WriteJsonAsync(res, 404, new { error = "Use POST /api/session." });
        return;
    }

    try
    {
        using var payload = new MemoryStream();
        await req.InputStream.CopyToAsync(payload);
        if (payload.Length > 4096)
        {
            await WriteJsonAsync(res, 413, new { error = "Request is too large." });
            return;
        }

        using var upstreamRequest = new HttpRequestMessage(HttpMethod.Post, openAiEndpoint);
        upstreamRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        upstreamRequest.Content = new StringContent(
            """
            {
              "expires_after": { "anchor": "created_at", "seconds": 600 },
              "session": {
                "type": "realtime",
                "model": "gpt-realtime-2.1",
                "instructions": "You are ChatGPT, a friendly, helpful conversational voice assistant. Reply naturally and concisely. Speak your answer aloud. Let the user finish speaking before responding.",
                "audio": {
                  "input": {
                    "transcription": { "model": "gpt-4o-mini-transcribe", "language": "en" },
                    "turn_detection": { "type": "server_vad", "create_response": true, "interrupt_response": true }
                  },
                  "output": { "voice": "marin" }
                }
              }
            }
            """,
            Encoding.UTF8,
            "application/json");

        using var upstreamResponse = await client.SendAsync(upstreamRequest);
        var responseText = await upstreamResponse.Content.ReadAsStringAsync();
        using var responseDoc = JsonDocument.Parse(responseText);

        if (!upstreamResponse.IsSuccessStatusCode)
        {
            var message = responseDoc.RootElement.TryGetProperty("error", out var error) &&
                          error.TryGetProperty("message", out var msg)
                ? msg.GetString() ?? "OpenAI could not create a voice token."
                : "OpenAI could not create a voice token. Check your API key and API billing.";
            await WriteJsonAsync(res, (int)upstreamResponse.StatusCode, new { error = message });
            return;
        }

        var root = responseDoc.RootElement;
        var value = root.TryGetProperty("value", out var token) ? token.GetString() : null;
        if (string.IsNullOrWhiteSpace(value))
        {
            await WriteJsonAsync(res, 502, new { error = "OpenAI response did not include a temporary token." });
            return;
        }

        object? expiresAt = root.TryGetProperty("expires_at", out var expires) ? expires.GetRawText() : null;
        await WriteJsonAsync(res, 200, new { value, expires_at = expiresAt });
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Request failed: {ex.Message}");
        await WriteJsonAsync(res, 500, new { error = "Could not create a temporary voice token. Check the helper window for details." });
    }
}

static async Task WriteJsonAsync(HttpListenerResponse response, int statusCode, object body)
{
    try
    {
        response.StatusCode = statusCode;
        response.ContentType = "application/json; charset=utf-8";
        var json = JsonSerializer.Serialize(body);
        var bytes = Encoding.UTF8.GetBytes(json);
        response.ContentLength64 = bytes.Length;
        await response.OutputStream.WriteAsync(bytes);
    }
    catch { }
    finally
    {
        try { response.Close(); } catch { }
    }
}
