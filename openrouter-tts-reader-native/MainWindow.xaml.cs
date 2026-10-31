using System.Globalization;
using System.Buffers.Binary;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.IO;
using System.Net.Http;
using System.Net;
using System.Diagnostics;
using System.Speech.Recognition;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using NAudio.Wave;

namespace OpenRouterTtsReader;

public partial class MainWindow : Window
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(2) };
    private SpeechRecognitionEngine? _recognizer;
    private HttpListener? _bridgeListener;
    private CancellationTokenSource? _bridgeCts;
    private int _bridgePort;
    private bool _browserDictationOn;
    private WaveOutEvent? _output;
    private MediaFoundationReader? _audioReader;
    private readonly DispatcherTimer _autoReadTimer;
    private bool _dictationOn;
    private bool _isSpeaking;
    private bool _requestInFlight;
    private string _lastSpoken = "";
    private string? _audioPath;
    private readonly Dictionary<string, (string Value, string Label)[]> _voices = new()
    {
        ["canopylabs/orpheus-v1-english"] = new[] { ("hannah", "Hannah — female"), ("autumn", "Autumn — female"), ("diana", "Diana — female"), ("austin", "Austin — male"), ("daniel", "Daniel — male"), ("troy", "Troy — male") },
        ["mistralai/voxtral-mini-tts-2603"] = new[] { ("en_paul_neutral", "Paul — neutral English") },
        ["microsoft/mai-voice-2"] = new[] { ("en-US-Harper:MAI-Voice-2", "Harper — US English") }
    };

    public MainWindow()
    {
        InitializeComponent();
        _autoReadTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1400) };
        _autoReadTimer.Tick += (_, _) =>
        {
            _autoReadTimer.Stop();
            var value = TextBoxInput.Text.Trim();
            if (AutoReadCheckBox.IsChecked == true && value.Length > 0 && value != _lastSpoken && !_requestInFlight)
                _ = GenerateAndPlayAsync(value, automatic: true);
        };
        UpdateVoices();
        LoadOutputDevices();
        UpdateOutputDeviceAvailability();
    }

    private string SelectedModel => (ModelBox.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "canopylabs/orpheus-v1-english";
    private string SelectedVoice => (VoiceBox.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "eve";

    private void LoadOutputDevices()
    {
        OutputDeviceBox.Items.Clear();
        OutputDeviceBox.Items.Add(new ComboBoxItem { Content = "Windows default output", Tag = -1 });
        try
        {
            for (var i = 0; i < WaveOut.DeviceCount; i++)
            {
                var capabilities = WaveOut.GetCapabilities(i);
                OutputDeviceBox.Items.Add(new ComboBoxItem { Content = capabilities.ProductName, Tag = i });
            }
        }
        catch (Exception ex)
        {
            SetStatus("Could not enumerate audio output devices: " + ex.Message);
        }
        OutputDeviceBox.SelectedIndex = 0;
    }

    private void ModelBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (VoiceBox is not null) UpdateVoices();
        UpdateOutputDeviceAvailability();
    }

    private void UpdateOutputDeviceAvailability()
    {
        if (OutputDeviceBox is null || ModelBox.SelectedItem is not ComboBoxItem item) return;
        var edgeMode = item.Tag?.ToString() == "edge-browser";
        OutputDeviceBox.IsEnabled = true;
        OutputDeviceBox.ToolTip = "Select the Windows audio output used by NAudio playback, including Microsoft Edge neural voices.";
    }

    private void UpdateVoices()
    {
        if (VoiceBox is null || ModelBox.SelectedItem is not ComboBoxItem item) return;
        var model = item.Tag?.ToString() ?? "canopylabs/orpheus-v1-english";
        VoiceBox.Items.Clear();
        if (model == "edge-browser")
        {
            foreach (var voice in new[] { ("Microsoft Aria Online (Natural) - English (United States)", "en-US-AriaNeural"), ("Microsoft Sonia Online (Natural) - English (United Kingdom)", "en-GB-SoniaNeural"), ("Microsoft Ryan Online (Natural) - English (United Kingdom)", "en-GB-RyanNeural"), ("Microsoft Natasha Online (Natural) - English (Australia)", "en-AU-NatashaNeural"), ("Microsoft Jenny Online (Natural) - English (United States)", "en-US-JennyNeural") })
                VoiceBox.Items.Add(new ComboBoxItem { Content = voice.Item1, Tag = voice.Item2 });
        }
        else if (model == "local-windows")
        {
            try
            {
                using var synth = new System.Speech.Synthesis.SpeechSynthesizer();
                foreach (var voice in synth.GetInstalledVoices().Where(v => v.Enabled).Select(v => v.VoiceInfo).OrderBy(v => v.Name))
                    VoiceBox.Items.Add(new ComboBoxItem { Content = voice.Name + " (" + voice.Culture.Name + ")", Tag = voice.Name });
            }
            catch { }
        }
        else if (_voices.TryGetValue(model, out var entries))
        {
            foreach (var entry in entries)
                VoiceBox.Items.Add(new ComboBoxItem { Content = entry.Label, Tag = entry.Value });
        }
        if (VoiceBox.Items.Count > 0) VoiceBox.SelectedIndex = 0;
    }

    private void StartBrowserDictation_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (_bridgeListener is null)
            {
                _bridgePort = GetFreePort();
                _bridgeListener = new HttpListener();
                _bridgeListener.Prefixes.Add("http://127.0.0.1:" + _bridgePort + "/");
                _bridgeListener.Start();
                _bridgeCts = new CancellationTokenSource();
                _ = RunBridgeServerAsync(_bridgeListener, _bridgeCts.Token);
            }
            _browserDictationOn = true;
            _dictationOn = true;
            StopDictationButton.IsEnabled = true;
            StartDictationButton.IsEnabled = true;
            try
            {
                Process.Start(new ProcessStartInfo("msedge.exe", "http://127.0.0.1:" + _bridgePort + "/") { UseShellExecute = true });
            }
            catch
            {
                Process.Start(new ProcessStartInfo("http://127.0.0.1:" + _bridgePort + "/") { UseShellExecute = true });
                SetStatus("Microsoft Edge was not found; opened the default browser instead.");
            }
            SetStatus("Opened browser speech bridge. Allow microphone access, then press Start Listening on that page.");
        }
        catch (Exception ex) { SetStatus("Could not start browser speech bridge: " + ex.Message); }
    }

    private static int GetFreePort()
    {
        using var tcp = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        tcp.Start();
        return ((System.Net.IPEndPoint)tcp.LocalEndpoint).Port;
    }

    private async Task RunBridgeServerAsync(HttpListener listener, CancellationToken token)
    {
        while (listener.IsListening && !token.IsCancellationRequested)
        {
            HttpListenerContext context;
            try { context = await listener.GetContextAsync().WaitAsync(token); }
            catch { break; }
            try
            {
                var req = context.Request;
                var res = context.Response;
                res.Headers["Access-Control-Allow-Origin"] = "*";
                res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
                res.Headers["Access-Control-Allow-Headers"] = "Content-Type";
                if (req.HttpMethod == "OPTIONS") { res.StatusCode = 204; res.Close(); continue; }
                if (req.HttpMethod == "GET")
                {
                    var bytes = Encoding.UTF8.GetBytes(BrowserBridgeHtml);
                    res.ContentType = "text/html; charset=utf-8";
                    res.ContentLength64 = bytes.Length;
                    await res.OutputStream.WriteAsync(bytes);
                }
                else if (req.HttpMethod == "POST" && req.Url?.AbsolutePath == "/transcript")
                {
                    using var reader = new StreamReader(req.InputStream, req.ContentEncoding);
                    using var doc = JsonDocument.Parse(await reader.ReadToEndAsync());
                    var root = doc.RootElement;
                    var phrase = root.TryGetProperty("text", out var te) ? te.GetString()?.Trim() : null;
                    var final = !root.TryGetProperty("final", out var fe) || fe.GetBoolean();
                    if (final && !string.IsNullOrWhiteSpace(phrase))
                        Dispatcher.BeginInvoke(() => AppendBrowserTranscript(phrase));
                    res.ContentType = "application/json";
                    var bytes = Encoding.UTF8.GetBytes("{\"ok\":true}");
                    res.ContentLength64 = bytes.Length;
                    await res.OutputStream.WriteAsync(bytes);
                }
                else res.StatusCode = 404;
                res.Close();
            }
            catch { try { context.Response.Abort(); } catch { } }
        }
    }

    private void AppendBrowserTranscript(string phrase)
    {
        if (!_browserDictationOn || _isSpeaking) return;
        if (TextBoxInput.Text.Length > 0 && !char.IsWhiteSpace(TextBoxInput.Text[^1]))
            TextBoxInput.AppendText(" ");
        TextBoxInput.AppendText(phrase + " ");
        TextBoxInput.ScrollToEnd();
        StatusText.Text = "Edge speech recognition: " + phrase;
        if (AutoReadCheckBox.IsChecked == true) { _autoReadTimer.Stop(); _autoReadTimer.Start(); }
    }

    private const string BrowserBridgeHtml = """
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Speech bridge</title>
<style>body{font:16px system-ui;max-width:760px;margin:40px auto;padding:0 18px;background:#111827;color:#f9fafb}button{font:inherit;padding:12px 18px;margin:6px;border:0;border-radius:8px;cursor:pointer}#start{background:#34d399}#stop{background:#fca5a5}#state,#heard{padding:12px;background:#1f2937;border-radius:8px}#heard{white-space:pre-wrap;min-height:120px}</style></head>
<body><h1>Microphone speech bridge</h1><p>Uses browser speech recognition instead of Windows desktop recognition, then sends recognized phrases to the running desktop app.</p><button id="start">Start Listening</button><button id="stop">Stop Listening</button><p id="state">Click Start Listening and allow microphone access.</p><div id="heard"></div>
<script>
const state=document.getElementById('state'),heard=document.getElementById('heard'),start=document.getElementById('start'),stop=document.getElementById('stop');
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null,running=false,transcriptClearTimer=null;
function showBridgeTranscript(text){
  heard.textContent=(heard.textContent+' '+text).trim();
  if(transcriptClearTimer)clearTimeout(transcriptClearTimer);
  transcriptClearTimer=setTimeout(()=>{heard.textContent='';transcriptClearTimer=null},5000);
}
async function send(text){try{await fetch('/transcript',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text,final:true})})}catch(e){state.textContent='Cannot reach desktop app. Keep EXE open and reload.'}}
if(!SR){state.textContent='SpeechRecognition unavailable. Open this page in current Chrome or Edge.';start.disabled=true}
else{
  let restartTimer=null,startWatchdog=null,retryDelay=300,sessionNumber=0;
  function clearTimers(){
    if(restartTimer){clearTimeout(restartTimer);restartTimer=null}
    if(startWatchdog){clearTimeout(startWatchdog);startWatchdog=null}
  }
  function scheduleRestart(reason){
    if(!running||restartTimer)return;
    state.textContent=reason||'Speech recognition ended. Reconnecting…';
    restartTimer=setTimeout(()=>{restartTimer=null;if(running)startRecognition()},retryDelay);
  }
  function startRecognition(){
    if(!running)return;
    clearTimers();
    // Create a fresh SpeechRecognition object for every session. Reusing an
    // ended Chrome instance can leave it stuck in InvalidStateError.
    const mySession=++sessionNumber;
    try{
      const next=new SR();
      rec=next;
      next.lang='en-US';next.continuous=true;next.interimResults=true;
      next.onstart=()=>{
        if(mySession!==sessionNumber)return;
        retryDelay=300;
        if(startWatchdog){clearTimeout(startWatchdog);startWatchdog=null}
        state.textContent='Listening to your microphone…';start.disabled=true;stop.disabled=false;
      };
      next.onerror=e=>{
        if(mySession!==sessionNumber||!running)return;
        state.textContent='Speech recognition interrupted ('+e.error+'). Reconnecting…';
        if(e.error==='not-allowed'||e.error==='service-not-allowed'){
          running=false;clearTimers();start.disabled=false;stop.disabled=true;
          state.textContent='Microphone/speech permission denied. Allow microphone access for this local page, then press Start Listening.';
        }
      };
      next.onresult=e=>{
        if(mySession!==sessionNumber||!running)return;
        let interim='';
        for(let i=e.resultIndex;i<e.results.length;i++){
          const t=e.results[i][0].transcript.trim();
          if(e.results[i].isFinal){showBridgeTranscript(t);send(t)}
          else interim+=t+' ';
        }
        if(interim)state.textContent='Listening… '+interim;
      };
      next.onend=()=>{
        if(mySession!==sessionNumber||!running)return;
        rec=null;
        retryDelay=300;
        scheduleRestart('Speech service ended. Reconnecting automatically…');
      };
      next.start();
      // If Chrome accepts start() but never emits onstart/onend, force a fresh
      // session rather than leaving the UI falsely stuck in Listening.
      startWatchdog=setTimeout(()=>{
        if(mySession===sessionNumber&&running){
          try{next.abort()}catch(e){}
          rec=null;retryDelay=Math.min(retryDelay*2,3000);
          scheduleRestart('Speech service did not start. Trying a fresh session…');
        }
      },8000);
    }catch(e){
      rec=null;retryDelay=Math.min(Math.max(retryDelay*1.5,500),3000);
      scheduleRestart('Could not restart speech service ('+e.message+'). Retrying…');
    }
  }
  start.onclick=async()=>{
    if(running)return;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      stream.getTracks().forEach(track=>track.stop());
      running=true;start.disabled=true;stop.disabled=false;
      retryDelay=300;state.textContent='Starting microphone recognition…';
      startRecognition();
    }catch(e){
      running=false;start.disabled=false;stop.disabled=true;
      state.textContent='Microphone error: '+e.message+'. Allow microphone access for 127.0.0.1 in Chrome site settings, then try again.';
    }
  };
  stop.onclick=()=>{
    running=false;sessionNumber++;clearTimers();
    const old=rec;rec=null;
    try{old&&old.abort()}catch(e){}
    start.disabled=false;stop.disabled=true;state.textContent='Stopped listening.';
  };
}
stop.disabled=true;
</script></body></html>
""";

    private void StartDictation_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (_recognizer is null)
            {
                var installed = SpeechRecognitionEngine.InstalledRecognizers();
                var recognizerInfo = installed
                    .OrderByDescending(x => x.Culture.Name.Equals("en-US", StringComparison.OrdinalIgnoreCase))
                    .ThenByDescending(x => x.Culture.TwoLetterISOLanguageName == "en")
                    .FirstOrDefault();
                if (recognizerInfo is null)
                    throw new InvalidOperationException("Windows has no desktop speech-recognition engine installed. Install/enable Windows Speech Recognition or Windows speech language support, then reopen this app.");
                _recognizer = new SpeechRecognitionEngine(recognizerInfo);
                _recognizer.LoadGrammar(new DictationGrammar());
                _recognizer.SetInputToDefaultAudioDevice();
                _recognizer.SpeechRecognized += (_, args) =>
                {
                    if (args.Result.Confidence < 0.25 || !_dictationOn || _isSpeaking) return;
                    var phrase = args.Result.Text.Trim();
                    if (phrase.Length == 0) return;
                    Dispatcher.BeginInvoke(() =>
                    {
                        if (!_dictationOn || _isSpeaking) return;
                        if (TextBoxInput.Text.Length > 0 && !char.IsWhiteSpace(TextBoxInput.Text[^1]))
                            TextBoxInput.AppendText(" ");
                        TextBoxInput.AppendText(phrase + " ");
                        TextBoxInput.ScrollToEnd();
                        if (AutoReadCheckBox.IsChecked == true)
                        {
                            _autoReadTimer.Stop();
                            _autoReadTimer.Start();
                        }
                    });
                };
                _recognizer.SpeechRecognitionRejected += (_, _) =>
                {
                    Dispatcher.BeginInvoke(() =>
                    {
                        if (_dictationOn && !_isSpeaking)
                            StatusText.Text = "Listening… (speech heard, but not recognized clearly)";
                    });
                };
            }

            if (_recognizer.AudioState != AudioState.Stopped)
                _recognizer.RecognizeAsyncCancel();

            _dictationOn = true;
            _recognizer.RecognizeAsync(RecognizeMode.Multiple);
            StartDictationButton.IsEnabled = false;
            StopDictationButton.IsEnabled = true;
            SetStatus("Listening to microphone with " + _recognizer.RecognizerInfo.Culture.Name + " Windows speech recognition. Speak now.");
        }
        catch (Exception ex)
        {
            _dictationOn = false;
            StartDictationButton.IsEnabled = true;
            StopDictationButton.IsEnabled = false;
            SetStatus("Dictation could not start: " + ex.Message + " Check Windows Settings > Privacy & security > Microphone and allow desktop apps.");
        }
    }

    private void StopDictation_Click(object sender, RoutedEventArgs e)
    {
        _dictationOn = false;
        _autoReadTimer.Stop();
        try { _recognizer?.RecognizeAsyncCancel(); } catch { }
        StartDictationButton.IsEnabled = true;
        StopDictationButton.IsEnabled = false;
        SetStatus("Dictation stopped.");
    }

    private void Speak_Click(object sender, RoutedEventArgs e) => _ = GenerateAndPlayAsync(TextBoxInput.Text.Trim(), automatic: false);

    private async Task GenerateAndPlayAsync(string value, bool automatic)
    {
        if (string.IsNullOrWhiteSpace(value) || _requestInFlight) return;
        var isLocal = SelectedModel == "local-windows";
        var isEdgeBrowser = SelectedModel == "edge-browser";
        var key = ApiKeyBox.Password.Trim();
        if (!isLocal && !isEdgeBrowser && key.Length == 0) { SetStatus("Enter your Groq API key first, or select Local Windows Voice (Free)."); return; }

        _autoReadTimer.Stop();
        _requestInFlight = true;
        SpeakButton.IsEnabled = false;
        if (_dictationOn)
        {
            _isSpeaking = true;
            try { _recognizer?.RecognizeAsyncCancel(); } catch { }
        }
        SetStatus(isLocal ? "Generating speech locally (no API or credits)…" : isEdgeBrowser ? "Generating Microsoft Edge neural voice audio…" : "Generating audio with Groq Orpheus…");
        try
        {
            if (isEdgeBrowser)
            {
                _audioPath = await GenerateEdgeMp3Async(value, SelectedVoice);
                await Dispatcher.InvokeAsync(() => StartPlayback(_audioPath, value, automatic));
                return;
            }
            if (isLocal)
            {
                _audioPath = Path.Combine(Path.GetTempPath(), $"local-tts-{Guid.NewGuid():N}.wav");
                var localPath = _audioPath;
                await Task.Run(() =>
                {
                    using var synth = new System.Speech.Synthesis.SpeechSynthesizer();
                    if (!string.IsNullOrWhiteSpace(SelectedVoice))
                        synth.SelectVoice(SelectedVoice);
                    synth.SetOutputToWaveFile(localPath);
                    synth.Speak(value);
                    synth.SetOutputToNull();
                });
                await Dispatcher.InvokeAsync(() => StartPlayback(localPath, value, automatic));
                return;
            }

            _audioPath = await GenerateGroqWavAsync(value, key);
            await Dispatcher.InvokeAsync(() => StartPlayback(_audioPath, value, automatic));
        }
        catch (Exception ex)
        {
            _isSpeaking = false;
            SetStatus("Could not generate/play speech: " + ex.Message);
            ResumeDictationIfNeeded();
        }
        finally
        {
            _requestInFlight = false;
            SpeakButton.IsEnabled = true;
        }
    }



    // Microsoft Edge Read Aloud neural voices: synthesize MP3, then route playback through NAudio.
    // This uses Microsoft's currently used (unofficial) Edge Read Aloud WebSocket protocol.
    private const string EdgeTrustedClientToken = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    private const string EdgeAudioFormat = "audio-24khz-48kbitrate-mono-mp3";

    private static string CreateEdgeSecurityToken()
    {
        var epoch = new DateTime(1601, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        long seconds = (long)Math.Floor((DateTime.UtcNow - epoch).TotalSeconds);
        seconds -= seconds % 300;
        var input = (seconds * 10_000_000L).ToString(CultureInfo.InvariantCulture) + EdgeTrustedClientToken;
        return Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(input)));
    }

    private static string EscapeEdgeSsml(string value) => value.Replace("&", "&amp;")
        .Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&apos;");

    private async Task<string> GenerateEdgeMp3Async(string text, string voice)
    {
        if (string.IsNullOrWhiteSpace(voice))
            throw new InvalidOperationException("Select a Microsoft Edge neural voice.");

        using var audio = new MemoryStream();
        foreach (var part in SplitForGroq(text, 1800))
        {
            var url = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
                "?TrustedClientToken=" + EdgeTrustedClientToken +
                "&Sec-MS-GEC=" + CreateEdgeSecurityToken() +
                "&Sec-MS-GEC-Version=1-130.0.2849.68&ConnectionId=" + Guid.NewGuid().ToString("N");

            using var socket = new ClientWebSocket();
            socket.Options.SetRequestHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0");
            socket.Options.SetRequestHeader("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold");
            socket.Options.SetRequestHeader("Pragma", "no-cache");
            socket.Options.SetRequestHeader("Cache-Control", "no-cache");
            await socket.ConnectAsync(new Uri(url), CancellationToken.None);

            var now = DateTime.UtcNow.ToString("ddd MMM dd yyyy HH:mm:ss 'GMT+0000 (Coordinated Universal Time)'", CultureInfo.InvariantCulture);
            var config = "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"" + EdgeAudioFormat + "\"}}}}";
            var configFrame = "X-Timestamp:" + now + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" + config;
            await socket.SendAsync(Encoding.UTF8.GetBytes(configFrame), WebSocketMessageType.Text, true, CancellationToken.None);

            var ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='" +
                voice + "'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>" + EscapeEdgeSsml(part) + "</prosody></voice></speak>";
            var requestFrame = "X-RequestId:" + Guid.NewGuid().ToString("N") +
                "\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:" +
                DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture) +
                "\r\nPath:ssml\r\n\r\n" + ssml;
            await socket.SendAsync(Encoding.UTF8.GetBytes(requestFrame), WebSocketMessageType.Text, true, CancellationToken.None);

            var buffer = new byte[16 * 1024];
            using var frameBuffer = new MemoryStream();
            while (socket.State == WebSocketState.Open)
            {
                frameBuffer.SetLength(0);
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Close) break;
                    frameBuffer.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);

                if (result.MessageType == WebSocketMessageType.Close) break;

                // Edge sends audio as binary frames, but the turn.end marker is
                // commonly delivered as a text frame. Ignoring text frames leaves
                // the receive loop waiting forever and prevents playback from starting.
                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var textFrame = Encoding.UTF8.GetString(frameBuffer.ToArray());
                    if (textFrame.Contains("Path:turn.end", StringComparison.OrdinalIgnoreCase))
                        break;
                    if (textFrame.Contains("Path:response", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Edge TTS rejected the synthesis request: " + textFrame);
                    continue;
                }

                if (result.MessageType != WebSocketMessageType.Binary) continue;

                var frame = frameBuffer.ToArray();
                if (frame.Length < 2) continue;
                int headerLength = BinaryPrimitives.ReadUInt16BigEndian(frame.AsSpan(0, 2));
                if (headerLength + 2 > frame.Length) continue;
                var headers = Encoding.ASCII.GetString(frame, 2, headerLength);
                if (headers.Contains("Path:audio", StringComparison.OrdinalIgnoreCase))
                    audio.Write(frame, headerLength + 2, frame.Length - headerLength - 2);
                if (headers.Contains("Path:turn.end", StringComparison.OrdinalIgnoreCase)) break;
            }

            try
            {
                if (socket.State == WebSocketState.Open)
                    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
            }
            catch { }
        }

        if (audio.Length == 0)
            throw new InvalidOperationException("Edge neural TTS returned no audio. Microsoft may have changed or rejected its Read Aloud service request.");

        var path = Path.Combine(Path.GetTempPath(), $"edge-tts-{Guid.NewGuid():N}.mp3");
        await File.WriteAllBytesAsync(path, audio.ToArray());
        return path;
    }

    private static IEnumerable<string> SplitForGroq(string text, int maxChars = 190)
    {
        var remaining = text.Trim();
        while (remaining.Length > maxChars)
        {
            var cut = remaining.LastIndexOfAny(new[] { '.', '!', '?', ';', ',', ' ' }, maxChars - 1);
            if (cut < maxChars / 2) cut = maxChars;
            var part = remaining[..cut].Trim();
            if (part.Length > 0) yield return part;
            remaining = remaining[cut..].Trim();
        }
        if (remaining.Length > 0) yield return remaining;
    }

    private async Task<string> GenerateGroqWavAsync(string text, string apiKey)
    {
        var chunks = SplitForGroq(text).ToArray();
        if (chunks.Length == 0) throw new InvalidOperationException("There is no text to read.");
        var tempFiles = new List<string>();
        try
        {
            foreach (var chunk in chunks)
            {
                var body = JsonSerializer.Serialize(new { model = SelectedModel, input = chunk, voice = SelectedVoice, response_format = "wav" });
                using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.groq.com/openai/v1/audio/speech");
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiKey);
                request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
                var bytes = await response.Content.ReadAsByteArrayAsync();
                if (!response.IsSuccessStatusCode)
                {
                    var detail = Encoding.UTF8.GetString(bytes);
                    try { detail = JsonDocument.Parse(detail).RootElement.GetProperty("error").GetProperty("message").GetString() ?? detail; } catch { }
                    throw new InvalidOperationException($"Groq HTTP {(int)response.StatusCode}: {detail}");
                }
                if (bytes.Length == 0) throw new InvalidOperationException("Groq returned an empty audio response.");
                var partPath = Path.Combine(Path.GetTempPath(), $"groq-tts-part-{Guid.NewGuid():N}.wav");
                await File.WriteAllBytesAsync(partPath, bytes);
                tempFiles.Add(partPath);
            }

            var combinedPath = Path.Combine(Path.GetTempPath(), $"groq-tts-{Guid.NewGuid():N}.wav");
            using var first = new WaveFileReader(tempFiles[0]);
            using (var writer = new WaveFileWriter(combinedPath, first.WaveFormat))
            {
                foreach (var partPath in tempFiles)
                {
                    using var reader = new WaveFileReader(partPath);
                    if (!reader.WaveFormat.Equals(first.WaveFormat))
                        throw new InvalidOperationException("Groq returned audio chunks with incompatible WAV formats.");
                    var buffer = new byte[65536];
                    int read;
                    while ((read = reader.Read(buffer, 0, buffer.Length)) > 0)
                        writer.Write(buffer, 0, read);
                }
            }
            return combinedPath;
        }
        finally
        {
            foreach (var file in tempFiles)
                try { File.Delete(file); } catch { }
        }
    }

    private void StartPlayback(string path, string value, bool automatic)
    {
        StopPlaybackResources();
        try
        {
            _audioReader = new MediaFoundationReader(path);
            _output = new WaveOutEvent();
            if (OutputDeviceBox.SelectedItem is ComboBoxItem selected && selected.Tag is int device && device >= 0)
                _output.DeviceNumber = device;
            _output.PlaybackStopped += (_, args) => Dispatcher.BeginInvoke(() =>
            {
                if (args.Exception is not null)
                    SetStatus("Audio playback failed: " + args.Exception.Message);
                FinishPlayback(args.Exception is null ? "Finished reading." : "Playback failed.");
            });
            _output.Init(_audioReader);
            _lastSpoken = value;
            StopAudioButton.IsEnabled = true;
            _isSpeaking = true;
            _output.Play();
            SetStatus((automatic ? "Reading dictated text" : "Reading text") + " through " + (OutputDeviceBox.SelectedItem as ComboBoxItem)?.Content + ".");
        }
        catch
        {
            StopPlaybackResources();
            throw;
        }
    }

    private void StopAudio_Click(object sender, RoutedEventArgs e)
    {
        try { _output?.Stop(); } catch { }
        FinishPlayback("Playback stopped.");
    }

    private void FinishPlayback(string message)
    {
        StopAudioButton.IsEnabled = false;
        StopPlaybackResources();
        if (ClearAfterReadCheckBox.IsChecked == true)
        {
            TextBoxInput.Clear();
            _lastSpoken = "";
        }
        SetStatus(message + (ClearAfterReadCheckBox.IsChecked == true ? " Text cleared." : ""));
        _isSpeaking = false;
        ResumeDictationIfNeeded();
    }

    private void StopPlaybackResources()
    {
        try { _output?.Dispose(); } catch { }
        try { _audioReader?.Dispose(); } catch { }
        _output = null;
        _audioReader = null;
    }

    private void ResumeDictationIfNeeded()
    {
        if (!_dictationOn || _recognizer is null) return;
        try
        {
            _isSpeaking = false;
            _recognizer.RecognizeAsync(RecognizeMode.Multiple);
            SetStatus("Listening to your microphone…");
        }
        catch (Exception ex)
        {
            SetStatus("Could not resume dictation: " + ex.Message + " Press Start microphone dictation to retry.");
            StartDictationButton.IsEnabled = true;
            StopDictationButton.IsEnabled = false;
        }
    }

    private void Clear_Click(object sender, RoutedEventArgs e)
    {
        _autoReadTimer.Stop();
        TextBoxInput.Clear();
        _lastSpoken = "";
        SetStatus("Text cleared.");
    }

    private void SetStatus(string message) => Dispatcher.Invoke(() => StatusText.Text = message);

    protected override void OnClosed(EventArgs e)
    {
        _dictationOn = false;
        _browserDictationOn = false;
        _autoReadTimer.Stop();
        try { _bridgeCts?.Cancel(); _bridgeListener?.Stop(); _bridgeListener?.Close(); } catch { }
        try { _recognizer?.RecognizeAsyncCancel(); _recognizer?.Dispose(); } catch { }
        StopPlaybackResources();
        try { if (_audioPath is not null && File.Exists(_audioPath)) File.Delete(_audioPath); } catch { }
        base.OnClosed(e);
    }
}