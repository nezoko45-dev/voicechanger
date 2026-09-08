using System;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using MelonLoader;
using NAudio.Wave;
using Newtonsoft.Json.Linq;

[assembly: MelonInfo(typeof(VoiceChangerMod.Main), "ChilloutVR VoiceChanger Mod", "1.3.0", "nezoko45-dev")]

namespace VoiceChangerMod;

public sealed class Main : MelonMod
{
    private const string FluxUrl = "wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.70&eager_eot_threshold=0.50&eot_timeout_ms=7000";
    private static readonly HttpClient Http = new HttpClient();
    private static ClientWebSocket? _socket;
    private static CancellationTokenSource? _cts;
    private static WaveInEvent? _mic;
    private static WaveOutEvent? _speaker;
    private static Mp3FileReader? _reader;
    private static MemoryStream? _audioStream;
    private static readonly SemaphoreSlim SendLock = new SemaphoreSlim(1, 1);
    private static readonly object StateLock = new object();
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
        MelonLogger.Msg("ChilloutVR VoiceChanger Mod 1.3.0 loaded.");
        MelonLogger.Msg("F8 = open/close VoiceChanger GUI | F10 = start/stop | F9 = stop");
    }

    public override void OnUpdate()
    {
        if ((NativeMethods.GetAsyncKeyState(0x77) & 0x0001) != 0) NativeGui.Toggle();
        if ((NativeMethods.GetAsyncKeyState(0x79) & 0x0001) != 0) { if (_enabled) StopVoiceChanger(); else StartVoiceChanger(); }
        if ((NativeMethods.GetAsyncKeyState(0x78) & 0x0001) != 0) StopVoiceChanger();
    }

    internal static string Status => _status;
    internal static string Transcript => _lastTranscript;
    internal static string ApiKey => _apiKey;
    internal static int SelectedVoice => _selectedVoice;
    internal static string[] VoiceNames
    {
        get { var a = new string[Voices.Length]; for (int i = 0; i < Voices.Length; i++) a[i] = Voices[i].Name; return a; }
    }

    internal static void SetGuiValues(string apiKey, int voice)
    {
        _apiKey = (apiKey ?? "").Trim();
        if (voice >= 0 && voice < Voices.Length) _selectedVoice = voice;
        SaveConfig();
        _status = string.IsNullOrWhiteSpace(_apiKey) ? "Missing Deepgram API key" : "Settings saved";
        NativeGui.Refresh();
    }

    internal static void StartFromGui(string apiKey, int voice)
    {
        _apiKey = (apiKey ?? "").Trim();
        if (voice >= 0 && voice < Voices.Length) _selectedVoice = voice;
        SaveConfig();
        StartVoiceChanger();
    }

    internal static void StopFromGui() => StopVoiceChanger();

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
                if (line.StartsWith("DeepgramApiKey=", StringComparison.OrdinalIgnoreCase)) _apiKey = line.Substring("DeepgramApiKey=".Length).Trim();
                else if (line.StartsWith("VoiceModel=", StringComparison.OrdinalIgnoreCase))
                {
                    string model = line.Substring("VoiceModel=".Length).Trim();
                    for (int i = 0; i < Voices.Length; i++) if (string.Equals(Voices[i].Model, model, StringComparison.OrdinalIgnoreCase)) { _selectedVoice = i; break; }
                }
            }
        }
        catch (Exception ex) { MelonLogger.Warning("Could not read VoiceChangerMod.cfg: " + ex.Message); }
    }

    private static void SaveConfig()
    {
        try
        {
            Directory.CreateDirectory("UserData");
            File.WriteAllText(Path.Combine("UserData", "VoiceChangerMod.cfg"), "# VoiceChanger settings\nDeepgramApiKey=" + _apiKey + "\nVoiceModel=" + Voices[_selectedVoice].Model + "\n");
        }
        catch (Exception ex) { MelonLogger.Warning("Could not save VoiceChangerMod.cfg: " + ex.Message); }
    }

    private static void StartVoiceChanger()
    {
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            _status = "Missing Deepgram API key";
            MelonLogger.Error("No Deepgram API key. Enter it in the F8 GUI or set DEEPGRAM_API_KEY.");
            NativeGui.Refresh();
            return;
        }
        lock (StateLock) { if (_enabled) return; _enabled = true; }
        _status = "Connecting to Deepgram...";
        NativeGui.Refresh();
        _cts = new CancellationTokenSource();
        _ = RunFluxAsync(_cts.Token);
        MelonLogger.Msg("VoiceChanger ENABLED using " + Voices[_selectedVoice].Name + ".");
    }

    private static void StopVoiceChanger()
    {
        lock (StateLock) { if (!_enabled && _cts == null) return; _enabled = false; }
        try { _cts?.Cancel(); } catch { }
        _cts = null;
        try { _mic?.StopRecording(); } catch { }
        try { _mic?.Dispose(); } catch { }
        _mic = null;
        try { _socket?.Abort(); _socket?.Dispose(); } catch { }
        _socket = null;
        StopPlayback();
        _status = "Disabled";
        NativeGui.Refresh();
        MelonLogger.Msg("VoiceChanger DISABLED.");
    }

    private static async Task RunFluxAsync(CancellationToken token)
    {
        try
        {
            using (var socket = new ClientWebSocket())
            {
                socket.Options.SetRequestHeader("Authorization", "Token " + _apiKey);
                _socket = socket;
                await socket.ConnectAsync(new Uri(FluxUrl), token).ConfigureAwait(false);
                _status = "Connected - listening";
                NativeGui.Refresh();
                StartMicrophone(token);
                await ReceiveFluxAsync(socket, token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _status = "Connection error";
            NativeGui.Refresh();
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
        _mic = new WaveInEvent { WaveFormat = new WaveFormat(16000, 16, 1), BufferMilliseconds = 80, NumberOfBuffers = 3 };
        _mic.DataAvailable += (_, e) =>
        {
            if (!_enabled || token.IsCancellationRequested || _socket?.State != WebSocketState.Open) return;
            byte[] copy = new byte[e.BytesRecorded]; Buffer.BlockCopy(e.Buffer, 0, copy, 0, e.BytesRecorded); _ = SendAudioAsync(copy, token);
        };
        _mic.RecordingStopped += (_, _) => MelonLogger.Msg("Microphone stopped.");
        _mic.StartRecording();
        MelonLogger.Msg("Microphone capture started at 16 kHz mono PCM.");
    }

    private static async Task SendAudioAsync(byte[] audio, CancellationToken token)
    {
        if (_socket?.State != WebSocketState.Open) return;
        await SendLock.WaitAsync(token).ConfigureAwait(false);
        try { if (_socket?.State == WebSocketState.Open) await _socket.SendAsync(new ArraySegment<byte>(audio), WebSocketMessageType.Binary, true, token).ConfigureAwait(false); }
        catch (OperationCanceledException) { }
        catch (Exception ex) { MelonLogger.Warning("Audio send failed: " + ex.Message); }
        finally { SendLock.Release(); }
    }

    private static async Task ReceiveFluxAsync(ClientWebSocket socket, CancellationToken token)
    {
        byte[] buffer = new byte[16 * 1024];
        using (var message = new MemoryStream())
        {
            while (!token.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                message.SetLength(0); WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    if (result.Count > 0) message.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);
                HandleFluxMessage(Encoding.UTF8.GetString(message.ToArray()));
            }
        }
    }

    private static void HandleFluxMessage(string json)
    {
        try
        {
            var root = JObject.Parse(json); string? type = (string?)root["type"];
            if (type == "TurnInfo")
            {
                string? transcript = (string?)root["transcript"]; string? evt = (string?)root["event"];
                if (!string.IsNullOrWhiteSpace(transcript)) { _lastTranscript = transcript; NativeGui.Refresh(); MelonLogger.Msg("You said: " + transcript); }
                if (evt == "EndOfTurn" && !string.IsNullOrWhiteSpace(transcript)) _ = SpeakAsSelectedVoiceAsync(transcript);
            }
            else if (type == "Error" || type == "FatalError") MelonLogger.Error("Deepgram Flux error: " + json);
        }
        catch (Exception ex) { MelonLogger.Warning("Could not parse Deepgram message: " + ex.Message); }
    }

    private static async Task SpeakAsSelectedVoiceAsync(string text)
    {
        if (!_enabled || string.IsNullOrWhiteSpace(text)) return;
        try
        {
            string url = "https://api.deepgram.com/v1/speak?model=" + Uri.EscapeDataString(Voices[_selectedVoice].Model);
            using (var request = new HttpRequestMessage(HttpMethod.Post, url))
            {
                request.Headers.TryAddWithoutValidation("Authorization", "Token " + _apiKey);
                request.Content = new StringContent(JObject.FromObject(new { text = text.Length > 2000 ? text.Substring(0, 2000) : text }).ToString(), Encoding.UTF8, "application/json");
                using (HttpResponseMessage response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode)
                    {
                        string error = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                        MelonLogger.Error("Deepgram TTS failed: " + (int)response.StatusCode + " " + error); _status = "TTS error"; NativeGui.Refresh(); return;
                    }
                    byte[] audio = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false); if (_enabled) PlayMp3(audio);
                }
            }
        }
        catch (Exception ex) { MelonLogger.Error("Voice conversion playback failed: " + ex.GetType().Name + ": " + ex.Message); }
    }

    private static void PlayMp3(byte[] audio)
    {
        StopPlayback(); _audioStream = new MemoryStream(audio, false); _reader = new Mp3FileReader(_audioStream); _speaker = new WaveOutEvent(); _speaker.Init(_reader);
        _speaker.PlaybackStopped += (_, _) => { try { _speaker?.Dispose(); } catch { } try { _reader?.Dispose(); } catch { } try { _audioStream?.Dispose(); } catch { } _speaker = null; _reader = null; _audioStream = null; };
        _speaker.Play();
    }

    private static void StopPlayback()
    {
        try { _speaker?.Stop(); } catch { } try { _speaker?.Dispose(); } catch { } try { _reader?.Dispose(); } catch { } try { _audioStream?.Dispose(); } catch { }
        _speaker = null; _reader = null; _audioStream = null;
    }
}

internal static class NativeGui
{
    private const int WM_CREATE = 0x0001, WM_CLOSE = 0x0010, WM_COMMAND = 0x0111;
    private const int SW_HIDE = 0, SW_SHOW = 5;
    private const int WS_OVERLAPPEDWINDOW = 0x00CF0000, WS_VISIBLE = 0x10000000, WS_CHILD = 0x40000000, WS_TABSTOP = 0x00010000;
    private const int BS_PUSHBUTTON = 0x00000000, CBS_DROPDOWNLIST = 0x0003, ES_PASSWORD = 0x0020;
    private const int WM_GETTEXT = 0x000D, WM_GETTEXTLENGTH = 0x000E, CB_ADDSTRING = 0x0143, CB_SETCURSEL = 0x014E, CB_GETCURSEL = 0x0147;
    private const int ID_KEY = 1001, ID_VOICE = 1002, ID_SAVE = 1003, ID_START = 1004, ID_STOP = 1005;
    private const int WM_USER_REFRESH = 0x042A;
    private static readonly object Sync = new object();
    private static Thread? _thread;
    private static IntPtr _window;
    private static IntPtr _key;
    private static IntPtr _voice;
    private static IntPtr _status;
    private static IntPtr _transcript;

    public static void Toggle()
    {
        lock (Sync)
        {
            if (_window != IntPtr.Zero) { ShowWindow(_window, IsWindowVisible(_window) ? SW_HIDE : SW_SHOW); Refresh(); return; }
            if (_thread != null && _thread.IsAlive) return;
            _thread = new Thread(WindowThread) { IsBackground = true, Name = "VoiceChanger Native GUI" };
            _thread.Start();
        }
    }

    public static void Refresh()
    {
        IntPtr h = _window;
        if (h != IntPtr.Zero) PostMessage(h, WM_USER_REFRESH, IntPtr.Zero, IntPtr.Zero);
    }

    private static void WindowThread()
    {
        try
        {
            WNDCLASS wc = new WNDCLASS { lpfnWndProc = WndProc, hInstance = GetModuleHandle(null), lpszClassName = "VoiceChangerNativeGui" };
            RegisterClass(ref wc);
            _window = CreateWindowEx(0, wc.lpszClassName, "ChilloutVR VoiceChanger", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 250, 180, 560, 420, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
        }
        catch (Exception ex) { MelonLogger.Error("Native GUI failed: " + ex.Message); }
        finally { _window = IntPtr.Zero; _thread = null; }
    }

    private static IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WM_CREATE)
        {
            IntPtr instance = GetModuleHandle(null);
            CreateWindowEx(0, "STATIC", "Deepgram API key", WS_CHILD | WS_VISIBLE, 25, 20, 250, 20, hwnd, IntPtr.Zero, instance, IntPtr.Zero);
            _key = CreateWindowEx(0, "EDIT", Main.ApiKey, WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_PASSWORD, 25, 45, 490, 28, hwnd, (IntPtr)ID_KEY, instance, IntPtr.Zero);
            CreateWindowEx(0, "STATIC", "Voice", WS_CHILD | WS_VISIBLE, 25, 80, 250, 20, hwnd, IntPtr.Zero, instance, IntPtr.Zero);
            _voice = CreateWindowEx(0, "COMBOBOX", "", WS_CHILD | WS_VISIBLE | WS_TABSTOP | CBS_DROPDOWNLIST, 25, 105, 490, 28, hwnd, (IntPtr)ID_VOICE, instance, IntPtr.Zero);
            foreach (string name in Main.VoiceNames) SendMessage(_voice, CB_ADDSTRING, IntPtr.Zero, name);
            SendMessage(_voice, CB_SETCURSEL, (IntPtr)Main.SelectedVoice, IntPtr.Zero);
            CreateWindowEx(0, "BUTTON", "Save settings", WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON, 25, 150, 150, 32, hwnd, (IntPtr)ID_SAVE, instance, IntPtr.Zero);
            CreateWindowEx(0, "BUTTON", "Start", WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON, 190, 150, 120, 32, hwnd, (IntPtr)ID_START, instance, IntPtr.Zero);
            CreateWindowEx(0, "BUTTON", "Stop", WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON, 325, 150, 120, 32, hwnd, (IntPtr)ID_STOP, instance, IntPtr.Zero);
            _status = CreateWindowEx(0, "STATIC", "Status: Disabled", WS_CHILD | WS_VISIBLE, 25, 205, 490, 25, hwnd, IntPtr.Zero, instance, IntPtr.Zero);
            CreateWindowEx(0, "STATIC", "Last transcript:", WS_CHILD | WS_VISIBLE, 25, 240, 490, 22, hwnd, IntPtr.Zero, instance, IntPtr.Zero);
            _transcript = CreateWindowEx(0, "STATIC", "", WS_CHILD | WS_VISIBLE, 25, 265, 490, 60, hwnd, IntPtr.Zero, instance, IntPtr.Zero);
            CreateWindowEx(0, "STATIC", "F8: show/hide   F10: start/stop   F9: stop", WS_CHILD | WS_VISIBLE, 25, 345, 490, 25, hwnd, IntPtr.Zero, instance, IntPtr.Zero);
            UpdateControls();
            return IntPtr.Zero;
        }
        if (msg == WM_USER_REFRESH) { UpdateControls(); return IntPtr.Zero; }
        if (msg == WM_COMMAND)
        {
            int id = (int)(wParam.ToInt64() & 0xFFFF);
            if (id == ID_SAVE || id == ID_START)
            {
                string key = GetText(_key);
                int voice = (int)SendMessage(_voice, CB_GETCURSEL, IntPtr.Zero, IntPtr.Zero).ToInt64();
                if (id == ID_SAVE) Main.SetGuiValues(key, voice); else Main.StartFromGui(key, voice);
                UpdateControls();
                return IntPtr.Zero;
            }
            if (id == ID_STOP) { Main.StopFromGui(); UpdateControls(); return IntPtr.Zero; }
        }
        if (msg == WM_CLOSE) { ShowWindow(hwnd, SW_HIDE); return IntPtr.Zero; }
        return DefWindowProc(hwnd, msg, wParam, lParam);
    }

    private static void UpdateControls()
    {
        if (_status != IntPtr.Zero) SetWindowText(_status, "Status: " + Main.Status);
        if (_transcript != IntPtr.Zero) SetWindowText(_transcript, Main.Transcript);
    }

    private static string GetText(IntPtr hwnd)
    {
        int len = (int)SendMessage(hwnd, WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero).ToInt64();
        if (len <= 0) return "";
        StringBuilder sb = new StringBuilder(len + 1);
        SendMessage(hwnd, WM_GETTEXT, (IntPtr)sb.Capacity, sb);
        return sb.ToString();
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct WNDCLASS
    {
        public uint style; public WndProcDelegate lpfnWndProc; public int cbClsExtra; public int cbWndExtra; public IntPtr hInstance; public IntPtr hIcon; public IntPtr hCursor; public IntPtr hbrBackground; public string lpszMenuName; public string lpszClassName;
    }
    [StructLayout(LayoutKind.Sequential)] private struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int x; public int y; }
    private delegate IntPtr WndProcDelegate(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern ushort RegisterClass(ref WNDCLASS lpWndClass);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowEx(int exStyle, string className, string windowName, int style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] private static extern IntPtr DefWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern int GetMessage(out MSG msg, IntPtr hWnd, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool SetWindowText(IntPtr hWnd, string text);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, string lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, StringBuilder lParam);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern void PostQuitMessage(int code);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);
}

internal static class NativeMethods
{
    [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int vKey);
}
