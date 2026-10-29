using System.Globalization;
using System.IO;
using System.Net.Http;
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
        if (!_voices.TryGetValue(model, out var entries)) return;
        foreach (var entry in entries)
            VoiceBox.Items.Add(new ComboBoxItem { Content = entry.Label, Tag = entry.Value });
        VoiceBox.SelectedIndex = 0;
    }

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
        var key = ApiKeyBox.Password.Trim();
        if (key.Length == 0) { SetStatus("Enter your OpenRouter API key first."); return; }

        _autoReadTimer.Stop();
        _requestInFlight = true;
        SpeakButton.IsEnabled = false;
        if (_dictationOn)
        {
            _isSpeaking = true;
            try { _recognizer?.RecognizeAsyncCancel(); } catch { }
        }
        SetStatus("Generating audio with OpenRouter…");
        try
        {
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
        _autoReadTimer.Stop();
        try { _recognizer?.RecognizeAsyncCancel(); _recognizer?.Dispose(); } catch { }
        StopPlaybackResources();
        try { if (_audioPath is not null && File.Exists(_audioPath)) File.Delete(_audioPath); } catch { }
        base.OnClosed(e);
    }
}