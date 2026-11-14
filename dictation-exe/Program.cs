using System;
using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Speech.Recognition;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace ChatGPTDictation
{
    internal static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }

    public sealed class MainForm : Form
    {
        private readonly Button start = new Button { Text = "START LISTENING", Dock = DockStyle.Top, Height = 48 };
        private readonly Button stop = new Button { Text = "STOP", Dock = DockStyle.Top, Height = 38, Enabled = false };
        private readonly Label status = new Label { Text = "Ready. Start listening, then use the Chrome extension on ChatGPT.", Dock = DockStyle.Fill, Padding = new Padding(12) };
        private SpeechRecognitionEngine recognizer;
        private LocalBridge bridge;

        public MainForm()
        {
            Text = "ChatGPT Dictation EXE";
            Width = 430; Height = 210;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            Controls.Add(status); Controls.Add(stop); Controls.Add(start);
            start.Click += async (s, e) => await StartListening();
            stop.Click += (s, e) => StopListening();
            FormClosing += (s, e) => StopListening();
            try { bridge = new LocalBridge(); bridge.Start(); status.Text += Environment.NewLine + Environment.NewLine + "Bridge ready: http://127.0.0.1:8765"; }
            catch (Exception ex) { status.Text += Environment.NewLine + "Bridge error: " + ex.Message; }
        }

        private async Task StartListening()
        {
            try
            {
                StopRecognizer();
                recognizer = new SpeechRecognitionEngine(CultureInfo.GetCultureInfo("en-US"));
                recognizer.SetInputToDefaultAudioDevice();
                recognizer.LoadGrammar(new DictationGrammar());
                recognizer.SpeechRecognized += (s, e) =>
                {
                    if (e.Result != null && e.Result.Confidence >= 0.55 && !String.IsNullOrWhiteSpace(e.Result.Text))
                    {
                        string phrase = e.Result.Text.Trim();
                        bridge?.Enqueue(phrase);
                        BeginInvoke((Action)(() => status.Text = "Recognized: " + phrase + Environment.NewLine + Environment.NewLine + "Listening continuously • localhost bridge active"));
                    }
                };
                recognizer.SpeechRecognitionRejected += (s, e) => { };
                recognizer.RecognizeCompleted += (s, e) => { };
                recognizer.RecognizeAsync(RecognizeMode.Multiple);
                start.Enabled = false; stop.Enabled = true;
                status.Text = "🎙 Listening… Speak naturally. Recognized phrases are queued for ChatGPT.";
            }
            catch (Exception ex) { status.Text = "Could not start microphone recognition: " + ex.Message; StopListening(); }
            await Task.CompletedTask;
        }

        private void StopRecognizer()
        {
            try { recognizer?.RecognizeAsyncCancel(); recognizer?.RecognizeAsyncStop(); recognizer?.Dispose(); } catch { }
            recognizer = null;
        }
        private void StopListening()
        {
            StopRecognizer();
            start.Enabled = true; stop.Enabled = false;
            if (!IsDisposed) status.Text = "Stopped. The localhost bridge remains available.";
        }
    }

    public sealed class LocalBridge
    {
        private readonly ConcurrentQueue<string> queue = new ConcurrentQueue<string>();
        private HttpListener listener;
        private CancellationTokenSource cancel;

        public void Start()
        {
            listener = new HttpListener();
            listener.Prefixes.Add("http://127.0.0.1:8765/");
            listener.Start();
            cancel = new CancellationTokenSource();
            Task.Run(() => Serve(cancel.Token));
        }
        public void Enqueue(string text) { queue.Enqueue(text); }

        private async Task Serve(CancellationToken token)
        {
            while (!token.IsCancellationRequested && listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = await listener.GetContextAsync(); } catch { break; }
                try
                {
                    ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
                    ctx.Response.Headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
                    ctx.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
                    if (ctx.Request.HttpMethod == "OPTIONS") { ctx.Response.StatusCode = 204; ctx.Response.Close(); continue; }
                    string path = ctx.Request.Url.AbsolutePath.ToLowerInvariant();
                    string body = "{}";
                    if (path == "/health") body = "{\"ok\":true,\"service\":\"ChatGPT Dictation EXE\"}";
                    else if (path == "/next")
                    {
                        string phrase;
                        if (queue.TryDequeue(out phrase)) body = "{\"text\":" + Json(phrase) + "}";
                        else body = "{\"text\":null}";
                    }
                    else { ctx.Response.StatusCode = 404; body = "{\"error\":\"not found\"}"; }
                    byte[] bytes = Encoding.UTF8.GetBytes(body);
                    ctx.Response.ContentType = "application/json; charset=utf-8";
                    ctx.Response.ContentLength64 = bytes.Length;
                    await ctx.Response.OutputStream.WriteAsync(bytes, 0, bytes.Length);
                    ctx.Response.Close();
                }
                catch { try { ctx.Response.Close(); } catch { } }
            }
        }
        private static string Json(string value)
        {
            return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n") + "\"";
        }
    }
}
