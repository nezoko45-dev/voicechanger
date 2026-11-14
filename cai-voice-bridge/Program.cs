using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

const int DebugPort = 9222;
const string DebugEndpoint = "http://127.0.0.1:9222/json";
using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
Console.Title = "Character.AI Voice Bridge";
Console.WriteLine("Character.AI Voice Bridge — automatic browser startup");
int commandId = 0;

EnsureDebugBrowser();
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

        if (target.ValueKind == JsonValueKind.Undefined) { await Task.Delay(2500); continue; }
        using var ws = new ClientWebSocket();
        ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        await ws.ConnectAsync(new Uri(target.GetProperty("webSocketDebuggerUrl").GetString()!), CancellationToken.None);
        Console.WriteLine("Connected to Character.AI. Press Ctrl+C to stop.");

        while (ws.State == WebSocketState.Open)
        {
            var js = "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')==='Toggle Character Voice');if(!b)return 'Voice button NOT FOUND';b.click();return 'Voice clicked; class='+b.className})()";
            var payload = JsonSerializer.Serialize(new { id = ++commandId, method = "Runtime.evaluate", @params = new { expression = js, returnByValue = true, awaitPromise = true } });
            await ws.SendAsync(Encoding.UTF8.GetBytes(payload), WebSocketMessageType.Text, true, CancellationToken.None);
            await Task.Delay(5000);
        }
    }
    catch (Exception ex) { Console.WriteLine($"Retry: {ex.Message}"); await Task.Delay(2500); EnsureDebugBrowser(); }
}

void EnsureDebugBrowser()
{
    try { using var check = new HttpClient { Timeout = TimeSpan.FromSeconds(1) }; check.GetAsync(DebugEndpoint).GetAwaiter().GetResult(); return; }
    catch { }
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
