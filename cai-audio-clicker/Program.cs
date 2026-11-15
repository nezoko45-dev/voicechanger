using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace CaiReplyAudioClicker
{
    internal static class Program
    {
        static readonly HttpClient Http = new HttpClient();
        static int commandId = 0;
        const string DebugAddress = "http://127.0.0.1:9222";
        const string CaiUrl = "https://character.ai/";

        static async Task Main()
        {
            Console.Title = "CAI Reply Audio Clicker";
            Console.WriteLine("Starting Chrome in remote-debug mode...");
            await EnsureDebugChrome();
            Console.WriteLine("Connected. Sign in to Character.AI in this Chrome profile if needed.");
            Console.WriteLine("Waiting for a reply to finish; then clicking its Read Aloud triangle. Ctrl+C exits.");

            bool generating = false;
            while (true)
            {
                try
                {
                    var target = await GetCaiTarget();
                    if (target == null) { await Task.Delay(1200); continue; }
                    using var ws = new ClientWebSocket();
                    await ws.ConnectAsync(new Uri(target), CancellationToken.None);
                    string state = await Evaluate(ws, @"(() => {
                      const t = document.body.innerText.toLowerCase();
                      return (t.includes('stop generating') || t.includes('stop response')) ? 'generating' : 'idle';
                    })()");
                    if (state == "generating") generating = true;
                    else if (generating)
                    {
                        await Task.Delay(1300);
                        string clicked = await Evaluate(ws, @"(() => {
                          const visible = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
                          const btns = [...document.querySelectorAll('button')].filter(visible);
                          const isTriangle = b => [...b.querySelectorAll('svg path,svg polygon')].some(p => {
                            const d=(p.getAttribute('d')||'').trim();
                            const points=(p.getAttribute('points')||'').trim();
                            return (d.length>0 && /[Mm].*[Ll].*[Zz]/.test(d) && d.length<100) ||
                                   (points.split(/[ ,]+/).filter(Boolean).length===6);
                          });
                          const named=btns.filter(b => /read aloud|play audio|listen/i.test((b.getAttribute('aria-label')||'')+' '+(b.getAttribute('title')||'')+' '+b.innerText));
                          let target=named[named.length-1];
                          if(!target) {
                            const candidates=btns.filter(b=>isTriangle(b) && b.querySelector('svg'));
                            target=candidates[candidates.length-1];
                          }
                          if(!target) return 'not-found';
                          target.click(); return 'clicked:'+((target.getAttribute('aria-label')||target.title||'triangle').slice(0,60));
                        })()");
                        Console.WriteLine(DateTime.Now.ToString("HH:mm:ss") + " " + clicked);
                        if (clicked.StartsWith("clicked")) generating = false;
                    }
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "poll", CancellationToken.None);
                }
                catch (Exception ex) { Console.WriteLine("CDP: " + ex.Message); }
                await Task.Delay(700);
            }
        }

        static async Task EnsureDebugChrome()
        {
            // Reuse an already-running debug browser if one exists.
            if (await DebugEndpointReady()) return;
            string chrome = FindChrome();
            if (chrome == null) throw new FileNotFoundException("Chrome.exe not found. Install Google Chrome first.");

            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CAI-AudioClicker-Chrome");
            Directory.CreateDirectory(profile);
            var psi = new ProcessStartInfo(chrome)
            {
                UseShellExecute = false,
                Arguments = "--remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=" + Quote(profile) + " --no-first-run --no-default-browser-check " + Quote(CaiUrl)
            };
            Process.Start(psi);

            for (int i=0; i<40; i++) {
                if (await DebugEndpointReady()) return;
                await Task.Delay(500);
            }
            throw new TimeoutException("Chrome launched, but its debugging endpoint did not start on port 9222.");
        }

        static string FindChrome()
        {
            string[] paths = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe")
            };
            foreach (string p in paths) if (File.Exists(p)) return p;
            return null;
        }

        static string Quote(string value) => "\"" + value.Replace("\"", "\\\"") + "\"";

        static async Task<bool> DebugEndpointReady()
        {
            try { using var response = await Http.GetAsync(DebugAddress + "/json/version"); return response.IsSuccessStatusCode; }
            catch { return false; }
        }

        static async Task<string> GetCaiTarget()
        {
            try {
                using var doc = JsonDocument.Parse(await Http.GetStringAsync(DebugAddress + "/json"));
                foreach (var item in doc.RootElement.EnumerateArray()) {
                    string url = item.TryGetProperty("url", out var u) ? u.GetString() ?? "" : "";
                    string ws = item.TryGetProperty("webSocketDebuggerUrl", out var w) ? w.GetString() ?? "" : "";
                    if (url.Contains("character.ai", StringComparison.OrdinalIgnoreCase) && ws.Length > 0) return ws;
                }
            } catch { }
            return null;
        }

        static async Task<string> Evaluate(ClientWebSocket ws, string expression)
        {
            int id = Interlocked.Increment(ref commandId);
            string payload = JsonSerializer.Serialize(new { id, method="Runtime.evaluate", @params=new { expression, returnByValue=true } });
            await ws.SendAsync(Encoding.UTF8.GetBytes(payload), WebSocketMessageType.Text, true, CancellationToken.None);
            var buffer = new byte[8192];
            while (true) {
                using var ms = new MemoryStream();
                WebSocketReceiveResult result;
                do {
                    result = await ws.ReceiveAsync(buffer, CancellationToken.None);
                    ms.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);
                using var json = JsonDocument.Parse(ms.ToArray());
                var root = json.RootElement;
                if (!root.TryGetProperty("id", out var rid) || rid.GetInt32()!=id) continue;
                if (root.TryGetProperty("result", out var res) && res.TryGetProperty("result", out var val) && val.TryGetProperty("value", out var value))
                    return value.GetString() ?? "";
                return "no-value";
            }
        }
    }
}