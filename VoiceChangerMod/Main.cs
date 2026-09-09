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

[assembly: MelonInfo(typeof(VoiceChangerMod.Main), "ChilloutVR VoiceChanger Mod", "1.5.1", "nezoko45-dev")]

namespace VoiceChangerMod;

public sealed class Main : MelonMod
{
    private const string FluxUrl = "wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.70&eager_eot_threshold=0.50&eot_timeout_ms=7000";
    private const string CablePlaybackName = "Line 1";
    private const int CableDesiredLatencyMs = 20;
    private static readonly HttpClient Http = new HttpClient();
    private static ClientWebSocket? _socket;
    private static CancellationTokenSource? _cts;
    private static WaveInEvent? _mic;
    private static IWavePlayer? _speaker;
    private static WaveFileReader? _reader;
    private static MemoryStream? _audioStream;
    private static readonly SemaphoreSlim SendLock = new SemaphoreSlim(1, 1);
    private static readonly object StateLock = new object();
    private static bool _enabled;
    private static volatile bool _suppressMicProcessing;
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
        MelonLogger.Msg("ChilloutVR VoiceChanger Mod 1.5.1 loaded.");
        MelonLogger.Msg("F8 = GUI | F10 = Start/Stop | F9 = Stop");
        MelonLogger.Msg("TTS route = Deepgram WAV -> Virtual Audio Cable Line 1. No VB-CABLE or VoiceMeeter reference is used.");
    }

    public override void OnUpdate()
    {
        if ((NativeMethods.GetAsyncKeyState(0x77) & 1) != 0) NativeGui.Toggle();
        if ((NativeMethods.GetAsyncKeyState(0x79) & 1) != 0) { if (_enabled) StopVoiceChanger(); else StartVoiceChanger(); }
        if ((NativeMethods.GetAsyncKeyState(0x78) & 1) != 0) StopVoiceChanger();
    }

    internal static string Status => _status;
    internal static string Transcript => _lastTranscript;
    internal static string ApiKey => _apiKey;
    internal static int SelectedVoice => _selectedVoice;
    internal static string[] VoiceNames { get { var a = new string[Voices.Length]; for (int i = 0; i < Voices.Length; i++) a[i] = Voices[i].Name; return a; } }

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
            if (!File.Exists(path)) { Directory.CreateDirectory("UserData"); File.WriteAllText(path, "# VoiceChanger settings\nDeepgramApiKey=\nVoiceModel=aura-2-thalia-en\n"); return; }
            foreach (string line in File.ReadAllLines(path))
            {
                if (line.StartsWith("DeepgramApiKey=", StringComparison.OrdinalIgnoreCase)) _apiKey = line.Substring(15).Trim();
                else if (line.StartsWith("VoiceModel=", StringComparison.OrdinalIgnoreCase))
                {
                    string model = line.Substring(11).Trim();
                    for (int i = 0; i < Voices.Length; i++) if (string.Equals(Voices[i].Model, model, StringComparison.OrdinalIgnoreCase)) _selectedVoice = i;
                }
            }
        }
        catch (Exception ex) { MelonLogger.Warning("Config read failed: " + ex.Message); }
    }

    private static void SaveConfig()
    {
        try { Directory.CreateDirectory("UserData"); File.WriteAllText(Path.Combine("UserData", "VoiceChangerMod.cfg"), "# VoiceChanger settings\nDeepgramApiKey=" + _apiKey + "\nVoiceModel=" + Voices[_selectedVoice].Model + "\n"); }
        catch (Exception ex) { MelonLogger.Warning("Config save failed: " + ex.Message); }
    }

    private static void StartVoiceChanger()
    {
        if (string.IsNullOrWhiteSpace(_apiKey)) { _status = "Missing Deepgram API key"; MelonLogger.Error("No Deepgram API key. Enter it in the F8 GUI or set DEEPGRAM_API_KEY."); NativeGui.Refresh(); return; }
        lock (StateLock) { if (_enabled) return; _enabled = true; }
        _status = "Connecting to Deepgram..."; NativeGui.Refresh();
        _cts = new CancellationTokenSource(); _ = RunFluxAsync(_cts.Token);
        MelonLogger.Msg("VoiceChanger ENABLED using " + Voices[_selectedVoice].Name + ".");
    }

    private static void StopVoiceChanger()
    {
        lock (StateLock) { if (!_enabled && _cts == null) return; _enabled = false; }
        try { _cts?.Cancel(); } catch { } _cts = null;
        try { _mic?.StopRecording(); } catch { } try { _mic?.Dispose(); } catch { } _mic = null;
        try { _socket?.Abort(); _socket?.Dispose(); } catch { } _socket = null;
        StopPlayback(); _status = "Disabled"; NativeGui.Refresh();
    }

    private static async Task RunFluxAsync(CancellationToken token)
    {
        try
        {
            using (var socket = new ClientWebSocket())
            {
                socket.Options.SetRequestHeader("Authorization", "Token " + _apiKey); _socket = socket;
                await socket.ConnectAsync(new Uri(FluxUrl), token).ConfigureAwait(false);
                _status = "Connected - listening"; NativeGui.Refresh(); StartMicrophone(token); await ReceiveFluxAsync(socket, token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { _status = "Connection error"; NativeGui.Refresh(); MelonLogger.Error("Deepgram connection failed: " + ex.GetType().Name + ": " + ex.Message); }
        finally { try { _mic?.StopRecording(); } catch { } try { _mic?.Dispose(); } catch { } _mic = null; _socket = null; }
    }

    private static void StartMicrophone(CancellationToken token)
    {
        _mic = new WaveInEvent { WaveFormat = new WaveFormat(16000, 16, 1), BufferMilliseconds = 80, NumberOfBuffers = 3 };
        _mic.DataAvailable += (_, e) =>
        {
            if (_suppressMicProcessing || !_enabled || token.IsCancellationRequested || _socket?.State != WebSocketState.Open) return;
            byte[] copy = new byte[e.BytesRecorded]; Buffer.BlockCopy(e.Buffer, 0, copy, 0, e.BytesRecorded); _ = SendAudioAsync(copy, token);
        };
        _mic.StartRecording(); MelonLogger.Msg("Microphone capture started at 16 kHz mono PCM.");
    }

    private static async Task SendAudioAsync(byte[] audio, CancellationToken token)
    {
        if (_socket?.State != WebSocketState.Open) return;
        await SendLock.WaitAsync(token).ConfigureAwait(false);
        try { if (_socket?.State == WebSocketState.Open) await _socket.SendAsync(new ArraySegment<byte>(audio), WebSocketMessageType.Binary, true, token).ConfigureAwait(false); }
        catch (OperationCanceledException) { } catch (Exception ex) { MelonLogger.Warning("Audio send failed: " + ex.Message); } finally { SendLock.Release(); }
    }

    private static async Task ReceiveFluxAsync(ClientWebSocket socket, CancellationToken token)
    {
        byte[] buffer = new byte[16384];
        using (var message = new MemoryStream())
        {
            while (!token.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                message.SetLength(0); WebSocketReceiveResult result;
                do { result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token).ConfigureAwait(false); if (result.MessageType == WebSocketMessageType.Close) return; if (result.Count > 0) message.Write(buffer, 0, result.Count); } while (!result.EndOfMessage);
                HandleFluxMessage(Encoding.UTF8.GetString(message.ToArray()));
            }
        }
    }

    private static void HandleFluxMessage(string json)
    {
        try
        {
            var root = JObject.Parse(json);
            if ((string?)root["type"] == "TurnInfo")
            {
                if (_suppressMicProcessing) return;
                string? transcript = (string?)root["transcript"]; string? evt = (string?)root["event"];
                if (!string.IsNullOrWhiteSpace(transcript)) { _lastTranscript = transcript; NativeGui.Refresh(); MelonLogger.Msg("You said: " + transcript); }
                if (evt == "EndOfTurn" && !string.IsNullOrWhiteSpace(transcript)) _ = SpeakAsSelectedVoiceAsync(transcript);
            }
            else if ((string?)root["type"] == "Error" || (string?)root["type"] == "FatalError") MelonLogger.Error("Deepgram Flux error: " + json);
        }
        catch (Exception ex) { MelonLogger.Warning("Deepgram message parse failed: " + ex.Message); }
    }

    private static async Task SpeakAsSelectedVoiceAsync(string text)
    {
        if (!_enabled || string.IsNullOrWhiteSpace(text)) return;
        try
        {
            string url = "https://api.deepgram.com/v1/speak?model=" + Uri.EscapeDataString(Voices[_selectedVoice].Model) + "&encoding=linear16&container=wav";
            using (var request = new HttpRequestMessage(HttpMethod.Post, url))
            {
                request.Headers.TryAddWithoutValidation("Authorization", "Token " + _apiKey);
                request.Content = new StringContent(JObject.FromObject(new { text = text.Length > 2000 ? text.Substring(0, 2000) : text }).ToString(), Encoding.UTF8, "application/json");
                using (HttpResponseMessage response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode) { string error = await response.Content.ReadAsStringAsync().ConfigureAwait(false); _status = "TTS error"; NativeGui.Refresh(); MelonLogger.Error("Deepgram TTS failed: " + (int)response.StatusCode + " " + error); return; }
                    byte[] audio = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false); if (_enabled) PlayTtsWav(audio);
                }
            }
        }
        catch (Exception ex) { MelonLogger.Error("TTS request failed: " + ex.GetType().Name + ": " + ex.Message); }
    }

    private static int FindCableOutputLine1Device()
    {
        for (int i = 0; i < WaveOut.DeviceCount; i++)
        {
            WaveOutCapabilities caps = WaveOut.GetCapabilities(i);
            string name = caps.ProductName ?? string.Empty;
            MelonLogger.Msg("WaveOut playback device " + i + ": " + name);
            if (name.IndexOf(CablePlaybackName, StringComparison.OrdinalIgnoreCase) >= 0) return i;
        }
        return -1;
    }

    private static void PlayTtsWav(byte[] audio)
    {
        StopPlayback();
        int deviceNumber = FindCableOutputLine1Device();
        if (deviceNumber < 0)
        {
            _status = "Virtual Audio Cable Line 1 not found"; NativeGui.Refresh();
            MelonLogger.Error("Could not find the Virtual Audio Cable playback device 'Line 1'. Make sure Virtual Audio Cable is installed and enabled in Windows Sound settings.");
            return;
        }
        try
        {
            _suppressMicProcessing = true;
            _audioStream = new MemoryStream(audio, false);
            _reader = new WaveFileReader(_audioStream);
            var speaker = new WaveOutEvent { DeviceNumber = deviceNumber, DesiredLatency = CableDesiredLatencyMs, NumberOfBuffers = 2 };
            _speaker = speaker;
            speaker.PlaybackStopped += (_, e) => { if (e.Exception != null) MelonLogger.Error("TTS playback error: " + e.Exception.GetType().Name + ": " + e.Exception.Message); CleanupPlayback(); };
            speaker.Init(_reader);
            _status = "Speaking through Virtual Audio Cable Line 1"; NativeGui.Refresh();
            MelonLogger.Msg("TTS route: Deepgram WAV -> Virtual Audio Cable Line 1 (device " + deviceNumber + "). DesiredLatency=" + CableDesiredLatencyMs + "ms, buffers=2.");
            speaker.Play();
        }
        catch (Exception ex) { MelonLogger.Error("TTS playback failed: " + ex.GetType().Name + ": " + ex.Message); CleanupPlayback(); }
    }

    private static void CleanupPlayback()
    {
        try { _speaker?.Dispose(); } catch { }
        try { _reader?.Dispose(); } catch { }
        try { _audioStream?.Dispose(); } catch { }
        _speaker = null; _reader = null; _audioStream = null; _suppressMicProcessing = false;
    }

    private static void StopPlayback() { try { _speaker?.Stop(); } catch { } CleanupPlayback(); }
}

internal static class NativeGui
{
    private const int WM_COMMAND = 0x0111, WM_CLOSE = 0x0010, SW_HIDE = 0, SW_SHOW = 5;
    private const int WS_OVERLAPPEDWINDOW = 0x00CF0000, WS_CHILD = 0x40000000, WS_VISIBLE = 0x10000000, WS_TABSTOP = 0x00010000;
    private const int BS_PUSHBUTTON = 0, CBS_DROPDOWNLIST = 3, ES_PASSWORD = 0x20, ES_AUTOHSCROLL = 0x80;
    private const int WM_GETTEXT = 0x000D, CB_ADDSTRING = 0x0143, CB_SETCURSEL = 0x014E, CB_GETCURSEL = 0x0147, BN_CLICKED = 0;
    private static Thread? _thread; private static IntPtr _window, _apiEdit, _voiceCombo, _statusLabel, _transcriptLabel; private static readonly ManualResetEvent Ready = new ManualResetEvent(false); private static bool _visible;
    public static void Toggle() { EnsureStarted(); _visible = !_visible; if (_window != IntPtr.Zero) NativeMethods.ShowWindow(_window, _visible ? SW_SHOW : SW_HIDE); }
    public static void Refresh() { if (_window == IntPtr.Zero) return; try { NativeMethods.SetWindowText(_statusLabel, "Status: " + Main.Status); NativeMethods.SetWindowText(_transcriptLabel, "Last transcript: " + Main.Transcript); } catch { } }
    private static void EnsureStarted() { if (_thread != null) { Ready.WaitOne(1000); return; } _thread = new Thread(GuiThread) { IsBackground = true, Name = "VoiceChanger GUI" }; _thread.SetApartmentState(ApartmentState.STA); _thread.Start(); Ready.WaitOne(3000); }
    private static void GuiThread()
    {
        try
        {
            string cls = "VoiceChangerNativeWindow" + Environment.TickCount; var wc = new NativeMethods.WNDCLASS { lpfnWndProc = WndProc, lpszClassName = cls, hInstance = NativeMethods.GetModuleHandle(null) }; NativeMethods.RegisterClass(ref wc);
            _window = NativeMethods.CreateWindowEx(0, cls, "ChilloutVR VoiceChanger", WS_OVERLAPPEDWINDOW, 120, 120, 520, 360, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
            _apiEdit = CreateChild("EDIT", "", 20, 35, 460, 28, WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_PASSWORD | ES_AUTOHSCROLL, 1001);
            _voiceCombo = CreateChild("COMBOBOX", "", 20, 90, 300, 300, WS_CHILD | WS_VISIBLE | WS_TABSTOP | CBS_DROPDOWNLIST, 1002);
            for (int i = 0; i < Main.VoiceNames.Length; i++) NativeMethods.SendMessage(_voiceCombo, CB_ADDSTRING, IntPtr.Zero, Main.VoiceNames[i]);
            NativeMethods.SendMessage(_voiceCombo, CB_SETCURSEL, (IntPtr)Main.SelectedVoice, IntPtr.Zero);
            CreateChild("BUTTON", "Save settings", 330, 90, 150, 32, WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON, 1003); CreateChild("BUTTON", "Start", 20, 140, 140, 36, WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON, 1004); CreateChild("BUTTON", "Stop", 180, 140, 140, 36, WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON, 1005);
            _statusLabel = CreateChild("STATIC", "Status: " + Main.Status, 20, 200, 460, 28, WS_CHILD | WS_VISIBLE, 1006); _transcriptLabel = CreateChild("STATIC", "Last transcript: " + Main.Transcript, 20, 235, 460, 45, WS_CHILD | WS_VISIBLE, 1007);
            CreateChild("STATIC", "Deepgram API key", 20, 10, 200, 20, WS_CHILD | WS_VISIBLE, 1008); CreateChild("STATIC", "Voice", 20, 70, 200, 20, WS_CHILD | WS_VISIBLE, 1009); CreateChild("STATIC", "TTS: Virtual Audio Cable Line 1", 20, 290, 460, 25, WS_CHILD | WS_VISIBLE, 1010);
            NativeMethods.SetWindowText(_apiEdit, Main.ApiKey); NativeMethods.ShowWindow(_window, SW_HIDE); Ready.Set();
            while (NativeMethods.GetMessage(out var msg, IntPtr.Zero, 0, 0)) { NativeMethods.TranslateMessage(ref msg); NativeMethods.DispatchMessage(ref msg); }
        }
        catch (Exception ex) { MelonLogger.Error("Native GUI failed: " + ex.Message); Ready.Set(); }
    }
    private static IntPtr CreateChild(string type, string text, int x, int y, int w, int h, int style, int id) => NativeMethods.CreateWindowEx(0, type, text, style, x, y, w, h, _window, (IntPtr)id, NativeMethods.GetModuleHandle(null), IntPtr.Zero);
    private static IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WM_COMMAND)
        {
            int id = unchecked((short)((long)wParam & 0xFFFF)); int code = unchecked((short)(((long)wParam >> 16) & 0xFFFF));
            if (code == BN_CLICKED && (id == 1003 || id == 1004)) { var sb = new StringBuilder(4096); NativeMethods.SendMessage(_apiEdit, WM_GETTEXT, (IntPtr)sb.Capacity, sb); int voice = (int)NativeMethods.SendMessage(_voiceCombo, CB_GETCURSEL, IntPtr.Zero, IntPtr.Zero); if (id == 1003) Main.SetGuiValues(sb.ToString(), voice); else Main.StartFromGui(sb.ToString(), voice); return IntPtr.Zero; }
            if (code == BN_CLICKED && id == 1005) { Main.StopFromGui(); return IntPtr.Zero; }
        }
        if (msg == WM_CLOSE) { NativeMethods.ShowWindow(hwnd, SW_HIDE); _visible = false; return IntPtr.Zero; }
        return NativeMethods.DefWindowProc(hwnd, msg, wParam, lParam);
    }
}

internal static class NativeMethods
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct WNDCLASS { public uint style; public WndProcDelegate lpfnWndProc; public int cbClsExtra; public int cbWndExtra; public IntPtr hInstance; public IntPtr hIcon; public IntPtr hCursor; public IntPtr hbrBackground; public string lpszMenuName; public string lpszClassName; }
    [StructLayout(LayoutKind.Sequential)] internal struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int ptX; public int ptY; }
    internal delegate IntPtr WndProcDelegate(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern ushort RegisterClass(ref WNDCLASS lpWndClass);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr CreateWindowEx(int exStyle, string className, string windowName, int style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern bool SetWindowText(IntPtr hWnd, string text);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, StringBuilder lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, string lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] internal static extern bool GetMessage(out MSG lpMsg, IntPtr hWnd, uint minFilter, uint maxFilter);
    [DllImport("user32.dll")] internal static extern bool TranslateMessage(ref MSG lpMsg);
    [DllImport("user32.dll")] internal static extern IntPtr DispatchMessage(ref MSG lpMsg);
    [DllImport("user32.dll")] internal static extern IntPtr DefWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr GetModuleHandle(string? lpModuleName);
}
