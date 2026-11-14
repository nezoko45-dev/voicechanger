using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

const string DebugEndpoint = "http://127.0.0.1:9222/json";
using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
Console.Title = "Character.AI Voice Bridge";
Console.WriteLine("Character.AI Voice Bridge — no browser extension required");
Console.WriteLine("Waiting for Character.AI at Chrome/Edge debugging port 9222...");
int commandId = 0;

while (true)
{
    try
    {
        using var response = await http.GetAsync(DebugEndpoint);
        response.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var target = doc.RootElement.EnumerateArray()
            .FirstOrDefault(x => x.TryGetProperty("type", out var type) && type.GetString() == "page"
                && x.TryGetProperty("url", out var url) && url.GetString()!.Contains("character.ai", StringComparison.OrdinalIgnoreCase));

        if (target.ValueKind == JsonValueKind.Undefined)
        {
            Console.WriteLine("Open character.ai in the launched browser. Checking again...");
            await Task.Delay(2500);
            continue;
        }

        var wsUrl = target.GetProperty("webSocketDebuggerUrl").GetString()!;
        using var ws = new ClientWebSocket();
        ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        await ws.ConnectAsync(new Uri(wsUrl), CancellationToken.None);
        Console.WriteLine("Connected to Character.AI tab. Voice button will be clicked every 5 seconds.");
        Console.WriteLine("Press Ctrl+C to stop.");

        while (ws.State == WebSocketState.Open)
        {
            var js = "(()=>{const b=document.querySelector('button[aria-label=\\\"Toggle Character Voice\\\"]');if(!b)return 'Voice button NOT FOUND';b.click();return 'Voice clicked; class='+b.className+'; state='+b.getAttribute('data-state')})()";
            var payload = JsonSerializer.Serialize(new { id = ++commandId, method = "Runtime.evaluate", @params = new { expression = js, returnByValue = true, awaitPromise = true } });
            var bytes = Encoding.UTF8.GetBytes(payload);
            await ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
            await Task.Delay(5000);
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Connection retry: {ex.Message}");
        await Task.Delay(2500);
    }
}
