using System;
using System.Net.Http;
using System.Reflection;
using System.Threading.Tasks;
using HarmonyLib;

namespace VoiceChangerMod;

// Replaces transcript -> TTS with true speech-to-speech voice conversion.
// The source audio is sent to ElevenLabs Voice Changer so the converted voice
// keeps the speaker's timing, emotion, and delivery instead of re-speaking text.
[HarmonyPatch(typeof(Main), "SpeakAsSelectedVoiceAsync")]
internal static class NaturalTtsPatch
{
    private static readonly HttpClient Http = new HttpClient();

    private static readonly MethodInfo PlayTtsWav = typeof(Main).GetMethod(
        "PlayTtsWav",
        BindingFlags.NonPublic | BindingFlags.Static) ?? throw new MissingMethodException("Main.PlayTtsWav was not found.");

    private static async Task ConvertAndSpeakAsync(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || !Main.Enabled || string.IsNullOrWhiteSpace(Main.ElevenLabsApiKey)) return;

        byte[] sourceAudio = Main.ConsumeTurnAudio();
        if (sourceAudio.Length < 3200)
        {
            MelonLoader.MelonLogger.Warning("Voice conversion skipped: not enough microphone audio was captured for this turn.");
            return;
        }

        string voiceId = Main.TargetVoiceId;
        if (string.IsNullOrWhiteSpace(voiceId))
        {
            MelonLoader.MelonLogger.Error("No ElevenLabs target voice ID is configured. Enter one in the F8 GUI.");
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
                request.Headers.TryAddWithoutValidation("xi-api-key", Main.ElevenLabsApiKey);
                request.Headers.TryAddWithoutValidation("Accept", "audio/wav");

                audio.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                form.Add(audio, "audio", "voice-input.pcm");
                form.Add(new StringContent("eleven_multilingual_sts_v2"), "model_id");
                form.Add(new StringContent("pcm_s16le_16"), "file_format");
                form.Add(new StringContent("false"), "remove_background_noise");
                request.Content = form;

                using (HttpResponseMessage response = await Http.SendAsync(
                    request,
                    HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode)
                    {
                        string error = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                        MelonLoader.MelonLogger.Error(
                            "ElevenLabs voice conversion failed: " + (int)response.StatusCode + " " + error);
                        return;
                    }

                    byte[] converted = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
                    if (converted.Length > 44 && Main.Enabled)
                    {
                        MelonLoader.MelonLogger.Msg("Voice conversion complete: " + sourceAudio.Length + " bytes in -> " + converted.Length + " bytes out.");
                        PlayTtsWav.Invoke(null, new object[] { converted });
                    }
                }
            }
        }
        catch (Exception ex)
        {
            MelonLoader.MelonLogger.Error(
                "ElevenLabs voice conversion failed: " + ex.GetType().Name + ": " + ex.Message);
        }
    }

    private static bool Prefix(string text)
    {
        _ = ConvertAndSpeakAsync(text);
        return false;
    }
}
