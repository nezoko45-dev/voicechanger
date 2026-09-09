using System;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using HarmonyLib;
using Newtonsoft.Json.Linq;

namespace VoiceChangerMod;

// Replaces the old one-shot Aura TTS call with Deepgram Flux TTS.
// Flux is designed for conversational speech and gives the output more natural
// pacing, pitch movement, and turn-to-turn delivery than the previous Aura path.
[HarmonyPatch(typeof(Main), "SpeakAsSelectedVoiceAsync")]
internal static class NaturalTtsPatch
{
    private static readonly HttpClient Http = new HttpClient();
    private static readonly MethodInfo PlayTtsWav = typeof(Main).GetMethod(
        "PlayTtsWav",
        BindingFlags.NonPublic | BindingFlags.Static) ?? throw new MissingMethodException("Main.PlayTtsWav was not found.");

    // Keeps the existing F8 voice list while routing each selection to a
    // current Deepgram Flux conversational voice.
    private static readonly string[] FluxVoices =
    {
        "flux-hannah-en",    // Thalia
        "flux-alexis-en",    // Andromeda
        "flux-sienna-en",    // Helena
        "flux-hannah-en",    // Amalthea
        "flux-haley-en",     // Luna
        "flux-gemma-en",     // Minerva
        "flux-brooke-en",    // Ophelia
        "flux-heather-en",   // Phoebe
        "flux-elise-en",     // Selene
        "flux-sharon-en",    // Theia
        "flux-bree-en",      // Vesta
        "flux-hannah-en",    // Asteria
        "flux-sienna-en",    // Athena
        "flux-gemma-en",     // Pandora
        "flux-cole-en",      // Apollo
        "flux-bruce-en",     // Arcas
        "flux-wade-en",      // Aries
        "flux-cliff-en",     // Jupiter
        "flux-drew-en",      // Mars
        "flux-miles-en",     // Neptune
        "flux-colin-en",     // Odysseus
        "flux-marcus-en",    // Orion
        "flux-jack-en",      // Orpheus
        "flux-conor-en",     // Pluto
        "flux-donovan-en",   // Saturn
        "flux-cliff-en"      // Zeus
    };

    // Skip the original Aura synthesis completely.
    private static bool Prefix(string text)
    {
        _ = SpeakNaturallyAsync(text);
        return false;
    }

    private static async Task SpeakNaturallyAsync(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || string.IsNullOrWhiteSpace(Main.ApiKey)) return;

        try
        {
            int voiceIndex = Main.SelectedVoice;
            if (voiceIndex < 0 || voiceIndex >= FluxVoices.Length) voiceIndex = 0;

            string naturalText = MakeSpeechFriendly(text);
            string model = FluxVoices[voiceIndex];
            string url = "https://api.deepgram.com/v2/speak?model=" + Uri.EscapeDataString(model)
                       + "&encoding=linear16&container=wav&sample_rate=24000"
                       + "&speed=1.0&expressivity=1";

            using (var request = new HttpRequestMessage(HttpMethod.Post, url))
            {
                request.Headers.TryAddWithoutValidation("Authorization", "Token " + Main.ApiKey);
                request.Content = new StringContent(
                    JObject.FromObject(new { text = naturalText }).ToString(),
                    Encoding.UTF8,
                    "application/json");

                using (HttpResponseMessage response = await Http.SendAsync(
                    request,
                    HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode)
                    {
                        string error = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                        MelonLoader.MelonLogger.Error(
                            "Flux TTS failed: " + (int)response.StatusCode + " " + error);
                        return;
                    }

                    byte[] audio = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
                    if (!string.Equals(Main.Status, "Disabled", StringComparison.OrdinalIgnoreCase))
                        PlayTtsWav.Invoke(null, new object[] { audio });
                }
            }
        }
        catch (Exception ex)
        {
            MelonLoader.MelonLogger.Error("Natural Flux TTS failed: " + ex.GetType().Name + ": " + ex.Message);
        }
    }

    private static string MakeSpeechFriendly(string text)
    {
        string result = text.Trim();
        if (result.Length > 2000) result = result.Substring(0, 2000);
        if (result.Length == 0) return result;

        char last = result[result.Length - 1];
        if (last != '.' && last != '!' && last != '?' && last != ':' && last != ';')
            result += ".";

        return result;
    }
}
