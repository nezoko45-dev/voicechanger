using System;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Threading.Tasks;
using HarmonyLib;

namespace VoiceChangerMod;

// Replaces transcript -> TTS with actual speech-to-speech voice conversion.
[HarmonyPatch(typeof(Main), "SpeakAsSelectedVoiceAsync")]
internal static class NaturalTtsPatch
{
    private static readonly HttpClient Http = new HttpClient();
    private static readonly FieldInfo EnabledField = typeof(Main).GetField("_enabled", BindingFlags.NonPublic | BindingFlags.Static)!;
    private static readonly MethodInfo PlayTtsWav = typeof(Main).GetMethod("PlayTtsWav", BindingFlags.NonPublic | BindingFlags.Static)
        ?? throw new MissingMethodException("Main.PlayTtsWav was not found.");

    private static string GetSetting(string name)
    {
        string? value = Environment.GetEnvironmentVariable(name)?.Trim();
        if (!string.IsNullOrWhiteSpace(value)) return value;

        try
        {
            string path = Path.Combine("UserData", "VoiceChangerMod.cfg");
            if (!File.Exists(path)) return "";

            string[] keys = name switch
            {
                "ELEVENLABS_API_KEY" => new[] { "ElevenLabsApiKey", "ELEVENLABS_API_KEY" },
                "ELEVENLABS_VOICE_ID" => new[] { "ElevenLabsVoiceId", "ELEVENLABS_VOICE_ID" },
                _ => new[] { name }
            };

            string[] lines = File.ReadAllLines(path);
            foreach (string key in keys)
            {
                string prefix = key + "=";
                foreach (string line in lines)
                {
                    if (!line.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
                    string candidate = line.Substring(prefix.Length).Trim();
                    if (!string.IsNullOrWhiteSpace(candidate)) return candidate;
                }
            }
        }
        catch (Exception ex)
        {
            MelonLoader.MelonLogger.Warning("ElevenLabs config read failed: " + ex.Message);
        }

        return "";
    }

    private static bool IsEnabled() => EnabledField.GetValue(null) is bool enabled && enabled;

    // ElevenLabs currently restricts 44.1 kHz WAV/PCM output to Pro+.
    // PCM 24 kHz is available on lower tiers, so request raw PCM and wrap it
    // in a standard WAV container before handing it to Main.PlayTtsWav().
    private static byte[] Pcm16Mono24kToWav(byte[] pcm)
    {
        const int sampleRate = 24000;
        const short channels = 1;
        const short bitsPerSample = 16;
        const short blockAlign = channels * (bitsPerSample / 8);
        const int byteRate = sampleRate * blockAlign;
        const int dataLength = pcm.Length;

        using var stream = new MemoryStream(44 + dataLength);
        using var writer = new BinaryWriter(stream);

        writer.Write(new[] { 'R', 'I', 'F', 'F' });
        writer.Write(36 + dataLength);
        writer.Write(new[] { 'W', 'A', 'V', 'E' });
        writer.Write(new[] { 'f', 'm', 't', ' ' });
        writer.Write(16);
        writer.Write((short)1); // PCM
        writer.Write(channels);
        writer.Write(sampleRate);
        writer.Write(byteRate);
        writer.Write(blockAlign);
        writer.Write(bitsPerSample);
        writer.Write(new[] { 'd', 'a', 't', 'a' });
        writer.Write(dataLength);
        writer.Write(pcm);
        writer.Flush();
        return stream.ToArray();
    }

    private static async Task ConvertAndSpeakAsync(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || !IsEnabled()) return;

        string apiKey = GetSetting("ELEVENLABS_API_KEY");
        string voiceId = GetSetting("ELEVENLABS_VOICE_ID");

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            MelonLoader.MelonLogger.Error("ElevenLabs voice conversion is not configured. Add ElevenLabsApiKey= or ELEVENLABS_API_KEY to UserData/VoiceChangerMod.cfg.");
            return;
        }

        if (string.IsNullOrWhiteSpace(voiceId))
        {
            MelonLoader.MelonLogger.Error("ElevenLabs target voice is not configured. Add ElevenLabsVoiceId= or ELEVENLABS_VOICE_ID to UserData/VoiceChangerMod.cfg.");
            return;
        }

        byte[] sourceAudio = VoiceConversionCapture.ConsumeAudio();
        if (sourceAudio.Length < 3200)
        {
            MelonLoader.MelonLogger.Warning("Voice conversion skipped: not enough microphone audio was captured for this turn.");
            return;
        }

        try
        {
            string url = "https://api.elevenlabs.io/v1/speech-to-speech/"
                       + Uri.EscapeDataString(voiceId)
                       + "?output_format=pcm_24000";

            using (var request = new HttpRequestMessage(HttpMethod.Post, url))
            using (var form = new MultipartFormDataContent())
            using (var audio = new ByteArrayContent(sourceAudio))
            {
                request.Headers.TryAddWithoutValidation("xi-api-key", apiKey);
                request.Headers.TryAddWithoutValidation("Accept", "audio/pcm");
                audio.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                form.Add(audio, "audio", "voice-input.pcm");
                form.Add(new StringContent("eleven_multilingual_sts_v2"), "model_id");
                form.Add(new StringContent("pcm_s16le_16"), "file_format");
                form.Add(new StringContent("false"), "remove_background_noise");
                request.Content = form;

                using (HttpResponseMessage response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode)
                    {
                        string error = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                        MelonLoader.MelonLogger.Error("ElevenLabs voice conversion failed: " + (int)response.StatusCode + " " + error);
                        return;
                    }

                    byte[] convertedPcm = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
                    if (convertedPcm.Length < 2)
                    {
                        MelonLoader.MelonLogger.Error("ElevenLabs returned an empty voice-conversion response.");
                        return;
                    }

                    if (!IsEnabled()) return;

                    byte[] convertedWav = Pcm16Mono24kToWav(convertedPcm);
                    MelonLoader.MelonLogger.Msg("Voice conversion complete: " + sourceAudio.Length + " bytes in -> " + convertedPcm.Length + " PCM bytes out (24 kHz), wrapped as WAV.");
                    PlayTtsWav.Invoke(null, new object[] { convertedWav });
                }
            }
        }
        catch (TargetInvocationException ex)
        {
            Exception inner = ex.InnerException ?? ex;
            MelonLoader.MelonLogger.Error("ElevenLabs playback invocation failed: " + inner.GetType().Name + ": " + inner.Message);
        }
        catch (Exception ex)
        {
            MelonLoader.MelonLogger.Error("ElevenLabs voice conversion failed: " + ex.GetType().Name + ": " + ex.Message);
        }
    }

    private static bool Prefix(string text)
    {
        _ = ConvertAndSpeakAsync(text);
        return false;
    }
}

[HarmonyPatch(typeof(Main), "StartMicrophone")]
internal static class VoiceConversionCapture
{
    private static readonly FieldInfo MicField = typeof(Main).GetField("_mic", BindingFlags.NonPublic | BindingFlags.Static)!;
    private static readonly object Lock = new object();
    private static readonly MemoryStream Buffer = new MemoryStream();
    private static NAudio.Wave.WaveInEvent? AttachedMic;

    private static void Postfix()
    {
        try
        {
            var mic = MicField.GetValue(null) as NAudio.Wave.WaveInEvent;
            if (mic == null || ReferenceEquals(mic, AttachedMic)) return;
            if (AttachedMic != null) AttachedMic.DataAvailable -= OnAudio;
            lock (Lock) Buffer.SetLength(0);
            AttachedMic = mic;
            AttachedMic.DataAvailable += OnAudio;
            MelonLoader.MelonLogger.Msg("Voice conversion capture attached to the existing microphone stream.");
        }
        catch (Exception ex)
        {
            MelonLoader.MelonLogger.Error("Voice conversion capture setup failed: " + ex.Message);
        }
    }

    private static void OnAudio(object? sender, NAudio.Wave.WaveInEventArgs e)
    {
        try
        {
            lock (Lock)
            {
                if (Buffer.Length > 4 * 1024 * 1024) Buffer.SetLength(0);
                Buffer.Write(e.Buffer, 0, e.BytesRecorded);
            }
        }
        catch { }
    }

    internal static byte[] ConsumeAudio()
    {
        lock (Lock)
        {
            byte[] data = Buffer.ToArray();
            Buffer.SetLength(0);
            return data;
        }
    }
}
