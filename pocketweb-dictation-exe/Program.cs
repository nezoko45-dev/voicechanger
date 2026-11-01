using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Reflection;

namespace PocketWebDictation;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

internal sealed class MainForm : Form
{
    private readonly TextBox portBox = new() { Text = "9222", Width = 72 };
    private readonly Button startButton = new() { Text = "Start dictation", AutoSize = true };
    private readonly Button stopButton = new() { Text = "Stop", AutoSize = true, Enabled = false };
    private readonly Label status = new() { AutoSize = true, Text = "Open PocketWebTools Voice Cloning in Chrome first." };
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(4) };
    private ClientWebSocket? socket;
    private int commandId;
    private readonly SemaphoreSlim commandLock = new(1, 1);
    private bool active;

    public MainForm()
    {
        Text = "PocketWeb Dictation";
        Width = 520;
        Height = 190;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        var root = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(16), FlowDirection = FlowDirection.TopDown, WrapContents = false };
        root.Controls.Add(new Label { Text = "Chrome debugging port:", AutoSize = true });
        root.Controls.Add(portBox);
        var buttons = new FlowLayoutPanel { AutoSize = true };
        buttons.Controls.Add(startButton);
        buttons.Controls.Add(stopButton);
        root.Controls.Add(buttons);
        status.MaximumSize = new Size(470, 0);
        root.Controls.Add(status);
        Controls.Add(root);
        startButton.Click += async (_, _) => await StartAsync();
        stopButton.Click += async (_, _) => await StopAsync();
        FormClosing += async (_, _) => { if (active) await StopAsync(); socket?.Dispose(); http.Dispose(); };
    }

    private void SetStatus(string value) => status.Text = value;

    private async Task StartAsync()
    {
        if (!int.TryParse(portBox.Text, out int port) || port < 1 || port > 65535)
        {
            SetStatus("Enter a valid debugging port.");
            return;
        }
        try
        {
            SetStatus("Connecting to Chrome…");
            var json = await http.GetStringAsync($"http://127.0.0.1:{port}/json");
            using var doc = JsonDocument.Parse(json);
            string? wsUrl = null;
            foreach (var target in doc.RootElement.EnumerateArray())
            {
                var url = target.TryGetProperty("url", out var u) ? u.GetString() : "";
                if (url != null && url.StartsWith("https://pocketweb.tools/voice-cloning", StringComparison.OrdinalIgnoreCase)
                    && target.TryGetProperty("webSocketDebuggerUrl", out var ws))
                {
                    wsUrl = ws.GetString();
                    break;
                }
            }
            if (string.IsNullOrWhiteSpace(wsUrl))
                throw new InvalidOperationException("PocketWebTools Voice Cloning tab not found. Open https://pocketweb.tools/voice-cloning in this Chrome window, then try again.");

            socket = new ClientWebSocket();
            await socket.ConnectAsync(new Uri(wsUrl), CancellationToken.None);
            string script = ReadEmbeddedScript();
            string encoded = JsonSerializer.Serialize(script);
            await EvaluateAsync($"(async()=>{{ if(window.__pwDictationStop) window.__pwDictationStop(); {script} return await window.__pwDictationStart(); }})()");
            active = true;
            startButton.Enabled = false;
            stopButton.Enabled = true;
            portBox.Enabled = false;
            SetStatus("Connected. Allow microphone access in Chrome if prompted. Listening for speech…");
            _ = PollStatusAsync();
        }
        catch (Exception ex)
        {
            socket?.Dispose();
            socket = null;
            SetStatus(ex.Message);
        }
    }

    private async Task StopAsync()
    {
        try
        {
            if (socket?.State == WebSocketState.Open)
                await EvaluateAsync("window.__pwDictationStop ? window.__pwDictationStop() : 'not running'");
        }
        catch { }
        active = false;
        socket?.Dispose();
        socket = null;
        startButton.Enabled = true;
        stopButton.Enabled = false;
        portBox.Enabled = true;
        SetStatus("Stopped.");
    }

    private async Task PollStatusAsync()
    {
        while (active && socket?.State == WebSocketState.Open)
        {
            try
            {
                var result = await EvaluateAsync("window.__pwDictationStatus || 'Listening…'");
                if (!IsDisposed && active) BeginInvoke(() => SetStatus(result));
            }
            catch (Exception ex)
            {
                if (!IsDisposed && active) BeginInvoke(() => SetStatus("Chrome connection lost: " + ex.Message));
                break;
            }
            await Task.Delay(1200);
        }
    }

    private async Task<string> EvaluateAsync(string expression)
    {
        if (socket?.State != WebSocketState.Open) throw new InvalidOperationException("Chrome debugging connection is closed.");
        await commandLock.WaitAsync();
        try
        {
            int id = Interlocked.Increment(ref commandId);
            var payload = JsonSerializer.Serialize(new { id, method = "Runtime.evaluate", @params = new { expression, awaitPromise = true, returnByValue = true } });
            await socket.SendAsync(Encoding.UTF8.GetBytes(payload).AsMemory(), WebSocketMessageType.Text, true, CancellationToken.None);
            var buffer = new byte[65536];
            while (true)
            {
                using var ms = new MemoryStream();
                ValueWebSocketReceiveResult part;
                do
                {
                    part = await socket.ReceiveAsync(buffer.AsMemory(), CancellationToken.None);
                    if (part.MessageType == WebSocketMessageType.Close) throw new InvalidOperationException("Chrome closed the debugging connection.");
                    ms.Write(buffer, 0, part.Count);
                } while (!part.EndOfMessage);
                using var doc = JsonDocument.Parse(ms.ToArray());
                var root = doc.RootElement;
                if (!root.TryGetProperty("id", out var gotId) || gotId.GetInt32() != id) continue;
                if (root.TryGetProperty("error", out var error)) throw new InvalidOperationException(error.ToString());
                var result = root.GetProperty("result");
                if (result.TryGetProperty("exceptionDetails", out var exception)) throw new InvalidOperationException(exception.ToString());
                if (result.TryGetProperty("result", out var remote) && remote.TryGetProperty("value", out var value))
                    return value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : value.ToString();
                return "Connected.";
            }
        }
        finally { commandLock.Release(); }
    }

    private static string ReadEmbeddedScript()
    {
        var asm = Assembly.GetExecutingAssembly();
        using var stream = asm.GetManifestResourceStream("PocketWebDictation.dictation.js")
            ?? throw new InvalidOperationException("Embedded dictation script is missing.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
