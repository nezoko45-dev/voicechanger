using System.Globalization;
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
    private readonly System.Collections.Concurrent.ConcurrentQueue<(string Text, string Voice)> _browserSpeechQueue = new();
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
        ["x-ai/grok-voice-tts-1.0"] = new[] { ("eve", "Eve — feminine"), ("ara", "Ara"), ("rex", "Rex"), ("sal", "Sal"), ("leo", "Leo") },
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
    }

    private string SelectedModel => (ModelBox.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "x-ai/grok-voice-tts-1.0";
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
    }

    private void UpdateVoices()
    {
        if (VoiceBox is null || ModelBox.SelectedItem is not ComboBoxItem item) return;
        var model = item.Tag?.ToString() ?? "x-ai/grok-voice-tts-1.0";
        VoiceBox.Items.Clear();
        if (model == "google-browser")
        {
            foreach (var voice in new[] { ("Google US English", "Google US English"), ("Google UK English Female", "Google UK English Female"), ("Google UK English Male", "Google UK English Male"), ("Google Australian English", "Google Australian English"), ("Browser default voice", "") })
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
            Process.Start(new ProcessStartInfo("http://127.0.0.1:" + _bridgePort + "/") { UseShellExecute = true });
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
                if (req.HttpMethod == "GET" && req.Url?.AbsolutePath == "/next-speech")
                {
                    var payload = _browserSpeechQueue.TryDequeue(out var item)
                        ? JsonSerializer.Serialize(new { text = item.Text, voice = item.Voice })
                        : "{\"text\":null}";
                    var bytes = Encoding.UTF8.GetBytes(payload);
                    res.ContentType = "application/json";
                    res.ContentLength64 = bytes.Length;
                    await res.OutputStream.WriteAsync(bytes);
                }
                else if (req.HttpMethod == "GET")
                {
                    var bytes = Encoding.UTF8.GetBytes(BrowserBridgeHtml);
                    res.ContentType = "text/html; charset=utf-8";
                    res.ContentLength64 = bytes.Length;
                    await res.OutputStream.WriteAsync(bytes);
                }
                else if (req.HttpMethod == "POST" && req.Url?.AbsolutePath == "/speech-done")
                {
                    Dispatcher.BeginInvoke(() =>
                    {
                        FinishPlayback("Finished reading with Chrome speech.");
                        _requestInFlight = false;
                        SpeakButton.IsEnabled = true;
                    });
                    res.StatusCode = 204;
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
        StatusText.Text = "Chrome speech recognition: " + phrase;
        if (AutoReadCheckBox.IsChecked == true) { _autoReadTimer.Stop(); _autoReadTimer.Start(); }
    }

    private const string BrowserBridgeHtml = """
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Speech bridge</title>
<style>body{font:16px system-ui;max-width:760px;margin:40px auto;padding:0 18px;background:#111827;color:#f9fafb}button{font:inherit;padding:12px 18px;margin:6px;border:0;border-radius:8px;cursor:pointer}#start{background:#34d399}#stop{background:#fca5a5}#state,#heard{padding:12px;background:#1f2937;border-radius:8px}#heard{white-space:pre-wrap;min-height:120px}</style></head>
<body><h1>Microphone speech bridge</h1><p>Uses browser speech recognition instead of Windows desktop recognition, then sends recognized phrases to the running desktop app.</p><button id="start">Start Listening</button><button id="stop">Stop Listening</button><p id="state">Click Start Listening and allow microphone access.</p><div id="heard"></div>
<script>
const state=document.getElementById('state'),heard=document.getElementById('heard'),start=document.getElementById('start'),stop=document.getElementById('stop');
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null,running=false;
async function pollSpeech(){try{const r=await fetch('/next-speech');const j=await r.json();if(j.text){const list=speechSynthesis.getVoices();const wanted=(j.voice||'').toLowerCase();const v=list.find(x=>x.name.toLowerCase()===wanted)||list.find(x=>wanted&&x.name.toLowerCase().includes(wanted))||list.find(x=>x.default)||list[0];speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(j.text);if(v)u.voice=v;u.onend=()=>fetch('/speech-done',{method:'POST'}).catch(()=>{});u.onerror=()=>fetch('/speech-done',{method:'POST'}).catch(()=>{});speechSynthesis.speak(u);state.textContent='Reading aloud with '+(v?v.name:'browser default voice')+'…'}}catch(e){}setTimeout(pollSpeech,350)}pollSpeech();
async function send(text){try{await fetch('/transcript',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text,final:true})})}catch(e){state.textContent='Cannot reach desktop app. Keep EXE open and reload.'}}
if(!SR){state.textContent='SpeechRecognition unavailable. Open this page in current Chrome or Edge.';start.disabled=true}
else{
  rec=new SR();rec.lang='en-US';rec.continuous=true;rec.interimResults=true;
  let restartTimer=null,starting=false;
  function scheduleRestart(){
    if(!running||restartTimer)return;
    state.textContent='Reconnecting microphone recognition…';
    restartTimer=setTimeout(()=>{
      restartTimer=null;
      if(!running||starting)return;
      try{starting=true;rec.start()}catch(e){starting=false;scheduleRestart()}
    },800);
  }
  rec.onstart=()=>{starting=false;state.textContent='Listening to your microphone…';start.disabled=true;stop.disabled=false};
  rec.onerror=e=>{
    starting=false;
    const fatal=['not-allowed','service-not-allowed','audio-capture'].includes(e.error);
    state.textContent=fatal
      ? 'Microphone/recognition error: '+e.error+'. Check Chrome site microphone permission and select the correct microphone.'
      : 'Speech recognition paused ('+e.error+'). Reconnecting automatically…';
    if(fatal){running=false;if(restartTimer){clearTimeout(restartTimer);restartTimer=null}start.disabled=false;stop.disabled=true}
  };
  rec.onresult=e=>{
    let interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const t=e.results[i][0].transcript.trim();
      if(e.results[i].isFinal){heard.textContent=(heard.textContent+' '+t).trim();send(t)}
      else interim+=t+' '
    }
    if(interim&&running)state.textContent='Listening… '+interim;
  };
  rec.onend=()=>{
    starting=false;
    if(running)scheduleRestart();
    else state.textContent='Not listening.';
  };
  start.onclick=async()=>{
    if(running)return;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      stream.getTracks().forEach(track=>track.stop());
      running=true;start.disabled=true;stop.disabled=false;
      state.textContent='Starting microphone recognition…';
      try{starting=true;rec.start()}catch(e){starting=false;scheduleRestart()}
    }catch(e){
      running=false;start.disabled=false;stop.disabled=true;
      state.textContent='Microphone error: '+e.message+'. Allow microphone access for 127.0.0.1 in Chrome site settings, then try again.';
    }
  };
  stop.onclick=()=>{
    running=false;starting=false;
    if(restartTimer){clearTimeout(restartTimer);restartTimer=null}
    try{rec.stop()}catch(e){}
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
        var isGoogleBrowser = SelectedModel == "google-browser";
        var key = ApiKeyBox.Password.Trim();
        if (isGoogleBrowser)
        {
            if (_bridgeListener is null || !_bridgeListener.IsListening)
                StartBrowserDictation_Click(this, new RoutedEventArgs());
            _browserSpeechQueue.Enqueue((value, SelectedVoice));
            _lastSpoken = value;
            _isSpeaking = true;
            _requestInFlight = true;
            SpeakButton.IsEnabled = false;
            SetStatus("Sent text to Chrome speech. Playback uses Chrome's selected audio output.");
            return;
        }
        if (!isLocal && key.Length == 0) { SetStatus("Enter your OpenRouter API key first, or select Local Windows Voice (Free)."); return; }

        _autoReadTimer.Stop();
        _requestInFlight = true;
        SpeakButton.IsEnabled = false;
        if (_dictationOn)
        {
            _isSpeaking = true;
            try { _recognizer?.RecognizeAsyncCancel(); } catch { }
        }
        SetStatus(isLocal ? "Generating speech locally (no API or credits)…" : "Generating audio with OpenRouter…");
        try
        {
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

            var body = JsonSerializer.Serialize(new { model = SelectedModel, input = value, voice = SelectedVoice, response_format = "mp3" });
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://openrouter.ai/api/v1/audio/speech");
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key);
            request.Headers.TryAddWithoutValidation("HTTP-Referer", "https://github.com/nezoko45-dev/voicechanger");
            request.Headers.TryAddWithoutValidation("X-OpenRouter-Title", "OpenRouter TTS Reader Native");
            request.Content = new StringContent(body, Encoding.UTF8, "application/json");
            using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            var bytes = await response.Content.ReadAsByteArrayAsync();
            if (!response.IsSuccessStatusCode)
            {
                var detail = Encoding.UTF8.GetString(bytes);
                try { detail = JsonDocument.Parse(detail).RootElement.GetProperty("error").GetProperty("message").GetString() ?? detail; } catch { }
                throw new InvalidOperationException($"OpenRouter HTTP {(int)response.StatusCode}: {detail}");
            }
            if (bytes.Length == 0) throw new InvalidOperationException("OpenRouter returned an empty audio response.");
            _audioPath = Path.Combine(Path.GetTempPath(), $"openrouter-tts-{Guid.NewGuid():N}.mp3");
            await File.WriteAllBytesAsync(_audioPath, bytes);
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