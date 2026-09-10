using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using MelonLoader;

namespace VoiceChangerMod;

internal static class BrowserController
{
    private static readonly string[] AllowedFiles = { "index.html", "app.js", "style.css" };
    private static HttpListener? _server;
    private static Thread? _serverThread;
    private static int _port;

    public static void Start()
    {
        try
        {
            StartServer();
            if (_port != 0)
                MelonLogger.Msg("VoiceChanger browser mode ready. Press F8 to open the control panel.");
        }
        catch (Exception ex)
        {
            MelonLogger.Error("VoiceChanger startup failed: " + ex);
        }
    }

    public static void Update()
    {
        if ((GetAsyncKeyState(0x77) & 1) != 0)
            OpenBrowser();
    }

    private static void OpenBrowser()
    {
        if (_port == 0)
        {
            MelonLogger.Error("VoiceChanger browser control panel is not running; no local port is available.");
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "http://127.0.0.1:" + _port + "/",
                UseShellExecute = true
            });
            MelonLogger.Msg("Opened VoiceChanger control panel at http://127.0.0.1:" + _port + "/");
        }
        catch (Exception ex)
        {
            MelonLogger.Error("Could not open browser: " + ex);
        }
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
        {
            if (File.Exists(Path.Combine(candidate, "index.html")))
            {
                root = candidate;
                break;
            }
        }

        if (root == null)
        {
            MelonLogger.Error("BrowserVoiceChanger files were not installed with the mod. Checked the mod directory and Mods\\BrowserVoiceChanger.");
            return;
        }

        for (int port = 17845; port <= 17855; port++)
        {
            HttpListener? listener = null;
            try
            {
                listener = new HttpListener();
                listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
                listener.Start();
                _server = listener;
                _port = port;
                _serverThread = new Thread(() => ServeLoop(root))
                {
                    IsBackground = true,
                    Name = "VoiceChanger Browser Server"
                };
                _serverThread.Start();
                MelonLogger.Msg("Browser UI hosted at http://127.0.0.1:" + port + "/");
                return;
            }
            catch (Exception ex)
            {
                try { listener?.Close(); } catch { }
                MelonLogger.Msg("Port " + port + " unavailable: " + ex.Message);
            }
        }

        MelonLogger.Error("Could not find a free local browser port from 17845-17855.");
    }

    private static void ServeLoop(string root)
    {
        while (_server != null)
        {
            HttpListenerContext? context = null;
            try { context = _server.GetContext(); }
            catch { break; }
            if (context == null) continue;

            string requested = context.Request.Url?.AbsolutePath?.TrimStart('/') ?? "";
            if (string.IsNullOrEmpty(requested)) requested = "index.html";

            if (requested.IndexOf("..", StringComparison.Ordinal) >= 0 || Array.IndexOf(AllowedFiles, requested) < 0)
            {
                context.Response.StatusCode = 404;
                context.Response.Close();
                continue;
            }

            string file = Path.Combine(root, requested);
            try
            {
                byte[] data = File.ReadAllBytes(file);
                context.Response.ContentType = requested.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
                    ? "text/html; charset=utf-8"
                    : requested.EndsWith(".css", StringComparison.OrdinalIgnoreCase)
                        ? "text/css; charset=utf-8"
                        : "application/javascript; charset=utf-8";
                context.Response.ContentLength64 = data.Length;
                context.Response.Headers["Cache-Control"] = "no-store";
                context.Response.OutputStream.Write(data, 0, data.Length);
            }
            catch (Exception ex)
            {
                MelonLogger.Error("Browser file request failed: " + ex);
                context.Response.StatusCode = 500;
            }
            finally
            {
                try { context.Response.OutputStream.Close(); } catch { }
            }
        }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);
}
