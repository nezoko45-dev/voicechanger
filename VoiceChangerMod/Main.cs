using System;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using MelonLoader;
using NAudio.Wave;
using Newtonsoft.Json.Linq;

[assembly: MelonInfo(typeof(VoiceChangerMod.Main), "ChilloutVR VoiceChanger Mod", "1.0.0", "nezoko45-dev")]

namespace VoiceChangerMod;

public sealed class Main : MelonMod
{
    private const string FluxUrl = "wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.70&eager_eot_threshold=0.50&eot_timeout_ms=7000";
    private const string TtsModel = "aura-2-thalia-en";

    private static readonly HttpClient Http = new();
    private static ClientWebSocket? _socket;
    private static CancellationTokenSource? _cts;
    private static WaveInEvent? _mic;
    private static WaveOutEvent? _speaker;
    private static Mp3FileReader? _reader;
    private static MemoryStream? _audioStream;
    private static readonly SemaphoreSlim SendLock = new(1, 1);
    private static bool _enabled;
    private static string _apiKey = "";
    private static string _lastTranscript = "";
    private static readonly object StateLock = new();

    public override void OnApplicationStart()
    {
        LoadApiKey();
        MelonLogger.Msg("ChilloutVR VoiceChanger Mod 1.0.0 loaded.");
        MelonLogger.Msg("F10 = toggle voice changer | F9 = stop");
        MelonLogger.Msg("Pipeline: microphone -> Deepgram Flux -> female Aura-2 TTS -> default Windows playback device.");
    }

    public override void OnUpdate()
    {
        if ((GetAsyncKeyState(0x79) & 0x0001) != 0)
        {
            if (_enabled) StopVoiceChanger();
            else StartVoiceChanger();
        }

        if ((GetAsyncKeyState(0x78) & 0x0001) != 0)
            StopVoiceChanger();
    }

    private static short GetAsyncKeyState(int key)
    {
        return NativeMethods.GetAsyncKeyState(key);
    }

    private static void LoadApiKey()
    {
        _apiKey = Environment.GetEnvironmentVariable("DEEPGRAM_API_KEY")?.Trim() ?? "";

        try
        {
            string path = Path.Combine("UserData", "VoiceChangerMod.cfg");
            if (!File.Exists(path))
            {
                Directory.CreateDirectory("UserData");
                File.WriteAllText(path, "# Put your Deepgram API key after the equals sign.\nDeepgramApiKey=\n");
                return;
            }

            foreach (string line in File.ReadAllLines(path))
            {
                if (!line.StartsWith("DeepgramApiKey=", StringComparison.OrdinalIgnoreCase))
                    continue;

                _apiKey = line.Substring("DeepgramApiKey=".Length).Trim();
                break;
            }
        }
        catch (Exception ex)
        {
            MelonLogger.Warning("Could not read VoiceChangerMod.cfg: " + ex.Message);
        }
    }

    private static void StartVoiceChanger()
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            MelonLogger.Error("No Deepgram API key. Put it in UserData/VoiceChangerMod.cfg or DEEPGRAM_API_KEY.");
            return;
        }

        lock (StateLock)
        {
            if (_enabled) return;
            _enabled = true;
        }

        _cts = new CancellationTokenSource();
        _ = RunFluxAsync(_cts.Token);
        MelonLogger.Msg("VoiceChanger ENABLED. Speak into your default Windows microphone.");
    }

    private static void StopVoiceChanger()
    {
        lock (StateLock)
        {
            if (!_enabled && _cts == null) return;
            _enabled = false;
        }

        try { _cts?.Cancel(); } catch { }
        _cts = null;

        try { _mic?.StopRecording(); } catch { }
        try { _mic?.Dispose(); } catch { }
        _mic = null;

        try { _socket?.Abort(); _socket?.Dispose(); } catch { }
        _socket = null;

        StopPlayback();
        MelonLogger.Msg("VoiceChanger DISABLED.");
    }

    private static async Task RunFluxAsync(CancellationToken token)
    {
        try
        {
            using var socket = new ClientWebSocket();
            socket.Options.SetRequestHeader("Authorization", "Token " + _apiKey);
            _socket = socket;

            await socket.ConnectAsync(new Uri(FluxUrl), token).ConfigureAwait(false);
            MelonLogger.Msg("Deepgram Flux connected.");

            StartMicrophone(token);
            await ReceiveFluxAsync(socket, token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            MelonLogger.Error("Deepgram connection failed: " + ex.GetType().Name + ": " + ex.Message);
        }
        finally
        {
            try { _mic?.StopRecording(); } catch { }
            try { _mic?.Dispose(); } catch { }
            _mic = null;
            _socket = null;
        }
    }

    private static void StartMicrophone(CancellationToken token)
    {
        _mic = new WaveInEvent
        {
            WaveFormat = new WaveFormat(16000, 16, 1),
            BufferMilliseconds = 80,
            NumberOfBuffers = 3
        };

        _mic.DataAvailable += (_, e) =>
        {
            if (!_enabled || token.IsCancellationRequested || _socket?.State != WebSocketState.Open)
                return;

            byte[] copy = new byte[e.BytesRecorded];
            Buffer.BlockCopy(e.Buffer, 0, copy, 0, e.BytesRecorded);
            _ = SendAudioAsync(copy, token);
        };

        _mic.RecordingStopped += (_, _) => MelonLogger.Msg("Microphone stopped.");
        _mic.StartRecording();
        MelonLogger.Msg("Microphone capture started at 16 kHz mono PCM.");
    }

    private static async Task SendAudioAsync(byte[] audio, CancellationToken token)
    {
        if (_socket?.State != WebSocketState.Open) return;

        await SendLock.WaitAsync(token).ConfigureAwait(false);
        try
        {
            if (_socket?.State == WebSocketState.Open)
                await _socket.SendAsync(new ArraySegment<byte>(audio), WebSocketMessageType.Binary, true, token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            MelonLogger.Warning("Audio send failed: " + ex.Message);
        }
        finally
        {
            SendLock.Release();
        }
    }

    private static async Task ReceiveFluxAsync(ClientWebSocket socket, CancellationToken token)
    {
        byte[] buffer = new byte[16 * 1024];
        using var message = new MemoryStream();

        while (!token.IsCancellationRequested && socket.State == WebSocketState.Open)
        {
            message.SetLength(0);
            WebSocketReceiveResult result;

            do
            {
                result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                    return;
                if (result.Count > 0)
                    message.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            string json = Encoding.UTF8.GetString(message.ToArray());
            HandleFluxMessage(json);
        }
    }

    private static void HandleFluxMessage(string json)
    {
        try
        {
            var root = JObject.Parse(json);
            string? type = (string?)root["type"];

            if (type == "TurnInfo")
            {
                string? transcript = (string?)root["transcript"];
                string? evt = (string?)root["event"];

                if (!string.IsNullOrWhiteSpace(transcript))
                    MelonLogger.Msg("You said: " + transcript);

                if (evt == "EndOfTurn" && !string.IsNullOrWhiteSpace(transcript) && transcript != _lastTranscript)
                {
                    _lastTranscript = transcript;
                    _ = SpeakAsWomanAsync(transcript);
                }
            }
            else if (type == "Error" || type == "FatalError")
            {
                MelonLogger.Error("Deepgram Flux error: " + json);
            }
        }
        catch (Exception ex)
        {
            MelonLogger.Warning("Could not parse Deepgram message: " + ex.Message);
        }
    }

    private static async Task SpeakAsWomanAsync(string text)
    {
        if (!_enabled || string.IsNullOrWhiteSpace(text)) return;

        try
        {
            string url = "https://api.deepgram.com/v1/speak?model=" + Uri.EscapeDataString(TtsModel);
            using var request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Headers.TryAddWithoutValidation("Authorization", "Token " + _apiKey);
            request.Content = new StringContent(
                JObject.FromObject(new { text = text.Length > 2000 ? text.Substring(0, 2000) : text }).ToString(),
                Encoding.UTF8,
                "application/json");

            using HttpResponseMessage response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                string error = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                MelonLogger.Error("Deepgram TTS failed: " + (int)response.StatusCode + " " + error);
                return;
            }

            byte[] audio = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
            if (!_enabled) return;

            PlayMp3(audio);
        }
        catch (Exception ex)
        {
            MelonLogger.Error("Voice conversion playback failed: " + ex.GetType().Name + ": " + ex.Message);
        }
    }

    private static void PlayMp3(byte[] audio)
    {
        StopPlayback();

        _audioStream = new MemoryStream(audio, writable: false);
        _reader = new Mp3FileReader(_audioStream);
        _speaker = new WaveOutEvent();
        _speaker.Init(_reader);
        _speaker.PlaybackStopped += (_, _) =>
        {
            try { _speaker?.Dispose(); } catch { }
            try { _reader?.Dispose(); } catch { }
            try { _audioStream?.Dispose(); } catch { }
            _speaker = null;
            _reader = null;
            _audioStream = null;
        };
        _speaker.Play();
    }

    private static void StopPlayback()
    {
        try { _speaker?.Stop(); } catch { }
        try { _speaker?.Dispose(); } catch { }
        try { _reader?.Dispose(); } catch { }
        try { _audioStream?.Dispose(); } catch { }
        _speaker = null;
        _reader = null;
        _audioStream = null;
    }

    private static class NativeMethods
    {
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        internal static extern short GetAsyncKeyState(int vKey);
    }
}
