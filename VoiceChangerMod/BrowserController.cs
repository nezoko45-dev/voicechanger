using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using HarmonyLib;
using MelonLoader;

namespace VoiceChangerMod;

public sealed class BrowserController : MelonMod
{
    private static readonly string[] AllowedFiles = { "index.html", "app.js", "style.css" };
    private static HttpListener? _server;
    private static Thread? _serverThread;
    private static int _port;

    public override void OnApplicationStart()
    {
        try
        {
            new Harmony("nezoko45-dev.voicechanger.browser").PatchAll();
            StartServer();
            MelonLogger.Msg("Browser VoiceChanger ready. Press F8 to open the browser tab.");
        }
        catch (Exception ex)
        {
            MelonLogger.Error("Browser VoiceChanger startup failed: " + ex.Message);
        }
    }

    public override void OnUpdate()
    {
        if ((GetAsyncKeyState(0x77) & 1) != 0) OpenBrowser();
    }

    private static void OpenBrowser()
    {
        if (_port == 0) return;
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "http://127.0.0.1:" + _port + "/",
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            MelonLogger.Error("Could not open browser: " + ex.Message);
        }
    }

    private static void StartServer()
    {
        string root = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "BrowserVoiceChanger");
        if (!Directory.Exists(root))
        {
            MelonLogger.Error("BrowserVoiceChanger folder was not installed beside the mod DLL: " + root);
            return;
        }

        for (int port = 17845; port <= 17855; port++)
        {
            try
            {
                var listener = new HttpListener();
                listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
                listener.Start();
                _server = listener;
                _port = port;
                _serverThread = new Thread(() => ServeLoop(root)) { IsBackground = true, Name = "VoiceChanger Browser Server" };
                _serverThread.Start();
                MelonLogger.Msg("Browser UI hosted at http://127.0.0.1:" + port + "/");
                return;
            }
            catch
            {
                try { _server?.Close(); } catch { }
                _server = null;
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
                context.Response.ContentType = requested.EndsWith(".html", StringComparison.OrdinalIgnoreCase) ? "text/html; charset=utf-8" :
                    requested.EndsWith(".css", StringComparison.OrdinalIgnoreCase) ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8";
                context.Response.ContentLength64 = data.Length;
                context.Response.Headers["Cache-Control"] = "no-store";
                context.Response.OutputStream.Write(data, 0, data.Length);
            }
            catch
            {
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

[HarmonyPatch(typeof(Main), nameof(Main.OnUpdate))]
internal static class MainOnUpdateBrowserPatch
{
    private static bool Prefix() => false;
}
