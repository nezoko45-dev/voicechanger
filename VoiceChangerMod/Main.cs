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

[assembly: MelonInfo(typeof(VoiceChangerMod.Main), "ChilloutVR VoiceChanger Mod", "1.6.0", "nezoko45-dev")]

namespace VoiceChangerMod;

public sealed class Main : MelonMod
{
    private const string FluxUrl = "wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.70&eager_eot_threshold=0.50&eot_timeout_ms=7000";
    private const int TtsDesiredLatencyMs = 20;
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
    private static string _selectedOutputDevice = "";

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
        MelonLogger.Msg("ChilloutVR VoiceChanger Mod 1.6.0 loaded.");
        MelonLogger.Msg("Browser mode is active. Press F8 to open the browser voice changer.");
        MelonLogger.Msg("The browser handles microphone capture, Deepgram STT/TTS, and output routing.");
    }

    public override void OnUpdate()
    {
        // BrowserController owns F8 and the browser-based voice changer.
        // The legacy in-game GUI/audio loop is intentionally not started here.
    }

    internal static string Status => _status;
    internal static string Transcript => _lastTranscript;
    internal static string ApiKey => _apiKey;
    internal static int SelectedVoice => _selectedVoice;
    internal static string SelectedOutputDevice => _selectedOutputDevice;
    internal static string[] VoiceNames { get { var a = new string[Voices.Length]; for (int i = 0; i < Voices.Length; i++) a[i] = Voices[i].Name; return a; } }
    internal static string[] OutputDeviceNames
    {