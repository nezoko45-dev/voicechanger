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
            if (File.Exists(path))
            {
                // Environment variable names and config keys are intentionally different.
                string configKey = name switch
                {
                    "ELEVENLABS_API_KEY" => "ElevenLabsApiKey",
                    "ELEVENLABS_VOICE_ID" => "ElevenLabsVoiceId",
                    _ => name
                };
                string prefix = configKey + "=";
                foreach (string line in File.ReadAllLines(path))
                {
                    if (line.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                        return line.Substring(prefix.Length).Trim();
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

    private static async Task ConvertAndSpeakAsync(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || !IsEnabled()) return;

        string apiKey = GetSetting("ELEVENLABS_API_KEY");
        string voiceId = GetSetting("ELEVENLABS_VOICE_ID");

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            MelonLoader.MelonLogger.Error("ElevenLabs voice conversion is not configured. Add ElevenLabsApiKey= to UserData/VoiceChangerMod.cfg or set ELEVENLABS_API_KEY.");
            return;
        }

        if (string.IsNullOrWhiteSpace(voiceId))
        {
            MelonLoader.MelonLogger.Error("ElevenLabs target voice is not configured. Add ElevenLabsVoiceId= to UserData/VoiceChangerMod.cfg or set ELEVENLABS_VOICE_ID.");
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
                       + "?output_format=wav_44100";

            using (var request = new HttpRequestMessage(HttpMethod.Post, url))
            using (var form = new MultipartFormDataContent())
            using (var audio = new ByteArrayContent(sourceAudio))
            {
                request.Headers.TryAddWithoutValidation("xi-api-key", apiKey);
                request.Headers.TryAddWithoutValidation("Accept", "audio/wav");
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

                    byte[] converted = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
                    if (converted.Length > 44 && IsEnabled())
                    {
                        MelonLoader.MelonLogger.Msg("Voice conversion complete: " + sourceAudio.Length + " bytes in -> " + converted.Length + " bytes out.");
                        PlayTtsWav.Invoke(null, new object[] { converted });
                    }
                }
            }
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
