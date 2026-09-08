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

[assembly: MelonInfo(typeof(VoiceChangerMod.Main), "ChilloutVR VoiceChanger Mod", "1.1.2", "nezoko45-dev")]

namespace VoiceChangerMod;

public sealed class Main : MelonMod
{
    private const string FluxUrl = "wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.70&eager_eot_threshold=0.50&eot_timeout_ms=7000";

    private static readonly HttpClient Http = new();
    private static ClientWebSocket? _socket;
    private static CancellationTokenSource? _cts;
    private static WaveInEvent? _mic;
    private static WaveOutEvent? _speaker;
    private static Mp3FileReader? _reader;
    private static MemoryStream? _audioStream;
    private static readonly SemaphoreSlim SendLock = new(1, 1);
    private static readonly object StateLock = new();

    private static bool _enabled;
    private static string _apiKey = "";
    private static string _lastTranscript = "";
    private static string _status = "Disabled";
    private static int _selectedVoice;

    private static readonly (string Name, string Model, string Description)[] Voices =
    {
        ("Thalia", "aura-2-thalia-en", "Feminine - American - Clear / energetic"),
        ("Andromeda", "aura-2-andromeda-en", "Feminine - American - Casual / expressive"),
        ("Helena", "aura-2-helena-en", "Feminine - American - Caring / natural / raspy"),
        ("Amalthea (Filipino)", "aura-2-amalthea-en", "Feminine - Filipino English - Young adult / cheerful"),
        ("Luna", "aura-2-luna-en", "Feminine - American - Friendly / natural"),
        ("Minerva", "aura-2-minerva-en", "Feminine - American - Positive / friendly"),
        ("Ophelia", "aura-2-ophelia-en", "Feminine - American - Expressive / cheerful"),
        ("Phoebe", "aura-2-phoebe-en", "Feminine - American - Energetic / warm"),
        ("Selene", "aura-2-selene-en", "Feminine - American - Expressive / engaging"),
        ("Theia", "aura-2-theia-en", "Feminine - Australian - Expressive / sincere"),
        ("Vesta", "aura-2-vesta-en", "Feminine - American - Natural / empathetic"),
        ("Asteria", "aura-2-asteria-en", "Feminine - American - Confident / energetic"),
        ("Athena", "aura-2-athena-en", "Feminine - American - Calm / professional"),
        ("Pandora", "aura-2-pandora-en", "Feminine - British - Smooth / melodic"),
        ("Apollo", "aura-2-apollo-en", "Masculine - American - Confident / casual"),
        ("Arcas", "aura-2-arcas-en", "Masculine - American - Natural / smooth"),
        ("Aries", "aura-2-aries-en", "Masculine - American - Warm / energetic"),
        ("Jupiter", "aura-2-jupiter-en", "Masculine - American - Expressive / baritone"),
        ("Mars", "aura-2-mars-en", "Masculine - American - Smooth / baritone"),
        ("Neptune", "aura-2-neptune-en", "Masculine - American - Professional / patient"),
        ("Odysseus", "aura-2-odysseus-en", "Masculine - American - Calm / smooth"),
        ("Orion", "aura-2-orion-en", "Masculine - American - Approachable / calm"),
        ("Orpheus", "aura-2-orpheus-en", "Masculine - American - Clear / confident"),
        ("Pluto", "aura-2-pluto-en", "Masculine - American - Calm / empathetic / baritone"),
        ("Saturn", "aura-2-saturn-en", "Masculine - American - Confident / baritone"),
        ("Zeus", "aura-2-zeus-en", "Masculine - American - Deep / trustworthy / smooth")
    };

    public override void OnApplicationStart()
    {
        LoadConfig();
        MelonLogger.Msg("ChilloutVR VoiceChanger Mod 1.1.2 loaded.");
        MelonLogger.Msg("UnityEngine dependency removed.");
        MelonLogger.Msg("F10 = start/stop | F9 = stop | VoiceModel is configured in UserData/VoiceChangerMod.cfg");
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

    private static short GetAsyncKeyState(int key) => NativeMethods.GetAsyncKeyState(key);

    private static void LoadConfig()
    {
        _apiKey = Environment.GetEnvironmentVariable("DEEPGRAM_API_KEY")?.Trim() ?? "";

        try
        {
            string path = Path.Combine("UserData", "VoiceChangerMod.cfg");
            if (!File.Exists(path))
            {
                Directory.CreateDirectory("UserData");
                File.WriteAllText(path, "# VoiceChanger settings\nDeepgramApiKey=\nVoiceModel=aura-2-thalia-en\n");
                return;
            }

            foreach (string line in File.ReadAllLines(path))
            {
                if (line.StartsWith("DeepgramApiKey=", StringComparison.OrdinalIgnoreCase))
                    _apiKey = line.Substring("DeepgramApiKey=".Length).Trim();
                else if (line.StartsWith("VoiceModel=", StringComparison.OrdinalIgnoreCase))
                {
                    string model = line.Substring("VoiceModel=".Length).Trim();
                    for (int i = 0; i < Voices.Length; i++)
                    {
                        if (string.Equals(Voices[i].Model, model, StringComparison.OrdinalIgnoreCase))
                        {
                            _selectedVoice = i;
                            break;
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            MelonLogger.Warning("Could not read VoiceChangerMod.cfg: " + ex.Message);
        }
    }

    private static void SaveConfig()
    {
        try
        {
            Directory.CreateDirectory("UserData");
            File.WriteAllText(Path.Combine("UserData", "VoiceChangerMod.cfg"),
                "# VoiceChanger settings\n" +
                "DeepgramApiKey=" + _apiKey + "\n" +
                "VoiceModel=" + Voices[_selectedVoice].Model + "\n");
        }
        catch (Exception ex)
        {
            MelonLogger.Warning("Could not save VoiceChangerMod.cfg: " + ex.Message);
        }
    }

    private static void StartVoiceChanger()
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            _status = "Missing Deepgram API key";
            MelonLogger.Error("No Deepgram API key. Set DEEPGRAM_API_KEY or UserData/VoiceChangerMod.cfg.");
            return;
        }

        lock (StateLock)
        {
            if (_enabled) return;
            _enabled = true;
        }

        _status = "Connecting to Deepgram...";
        _cts = new CancellationTokenSource();
        _ = RunFluxAsync(_cts.Token);
        MelonLogger.Msg("VoiceChanger ENABLED using " + Voices[_selectedVoice].Name + ".");
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
        _status = "Disabled";
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
            _status = "Connected - listening";
            StartMicrophone(token);
            await ReceiveFluxAsync(socket, token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _status = "Connection error";
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
            if (!_enabled || token.IsCancellationRequested || _socket?.State != WebSocketState.Open) return;
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
        catch (Exception ex) { MelonLogger.Warning("Audio send failed: " + ex.Message); }
        finally { SendLock.Release(); }
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
                if (result.MessageType == WebSocketMessageType.Close) return;
                if (result.Count > 0) message.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);
            HandleFluxMessage(Encoding.UTF8.GetString(message.ToArray()));
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
                {
                    _lastTranscript = transcript;
                    MelonLogger.Msg("You said: " + transcript);
                }
                if (evt == "EndOfTurn" && !string.IsNullOrWhiteSpace(transcript))
                    _ = SpeakAsSelectedVoiceAsync(transcript);
            }
            else if (type == "Error" || type == "FatalError")
                MelonLogger.Error("Deepgram Flux error: " + json);
        }
        catch (Exception ex) { MelonLogger.Warning("Could not parse Deepgram message: " + ex.Message); }
    }

    private static async Task SpeakAsSelectedVoiceAsync(string text)
    {
        if (!_enabled || string.IsNullOrWhiteSpace(text)) return;
        try
        {
            string model = Voices[_selectedVoice].Model;
            string url = "https://api.deepgram.com/v1/speak?model=" + Uri.EscapeDataString(model);
            using var request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Headers.TryAddWithoutValidation("Authorization", "Token " + _apiKey);
            request.Content = new StringContent(
                JObject.FromObject(new { text = text.Length > 2000 ? text.Substring(0, 2000) : text }).ToString(),
                Encoding.UTF8, "application/json");
            using HttpResponseMessage response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                string error = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                MelonLogger.Error("Deepgram TTS failed: " + (int)response.StatusCode + " " + error);
                _status = "TTS error";
                return;
            }
            byte[] audio = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
            if (_enabled) PlayMp3(audio);
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
