using System;
using System.IO;
using HarmonyLib;

namespace VoiceChangerMod;

// Main.SaveConfig currently rewrites the entire cfg file. This patch makes sure
// the ElevenLabs credentials survive that rewrite instead of being erased.
[HarmonyPatch(typeof(Main), "SaveConfig")]
internal static class ConfigPersistencePatch
{
    private const string ConfigPath = "UserData/VoiceChangerMod.cfg";
    private static readonly object Sync = new object();
    private static string _apiKey = "";
    private static string _voiceId = "";

    [HarmonyPrefix]
    private static void Prefix()
    {
        lock (Sync)
        {
            try
            {
                if (!File.Exists(ConfigPath)) return;

                foreach (string rawLine in File.ReadAllLines(ConfigPath))
                {
                    string line = rawLine.Trim();
                    if (line.StartsWith("ElevenLabsApiKey=", StringComparison.OrdinalIgnoreCase))
                        _apiKey = line.Substring("ElevenLabsApiKey=".Length).Trim();
                    else if (line.StartsWith("ElevenLabsVoiceId=", StringComparison.OrdinalIgnoreCase))
                        _voiceId = line.Substring("ElevenLabsVoiceId=".Length).Trim();
                }
            }
            catch (Exception ex)
            {
                MelonLoader.MelonLogger.Warning("ElevenLabs config preservation read failed: " + ex.Message);
            }
        }
    }

    [HarmonyPostfix]
    private static void Postfix()
    {
        lock (Sync)
        {
            try
            {
                Directory.CreateDirectory("UserData");

                var lines = File.Exists(ConfigPath)
                    ? new System.Collections.Generic.List<string>(File.ReadAllLines(ConfigPath))
                    : new System.Collections.Generic.List<string>();

                bool apiFound = false;
                bool voiceFound = false;

                for (int i = 0; i < lines.Count; i++)
                {
                    string line = lines[i];
                    if (line.StartsWith("ElevenLabsApiKey=", StringComparison.OrdinalIgnoreCase))
                    {
                        apiFound = true;
                        if (!string.IsNullOrWhiteSpace(_apiKey))
                            lines[i] = "ElevenLabsApiKey=" + Sanitize(_apiKey);
                    }
                    else if (line.StartsWith("ElevenLabsVoiceId=", StringComparison.OrdinalIgnoreCase))
                    {
                        voiceFound = true;
                        if (!string.IsNullOrWhiteSpace(_voiceId))
                            lines[i] = "ElevenLabsVoiceId=" + Sanitize(_voiceId);
                    }
                }

                if (!apiFound && !string.IsNullOrWhiteSpace(_apiKey))
                    lines.Add("ElevenLabsApiKey=" + Sanitize(_apiKey));
                if (!voiceFound && !string.IsNullOrWhiteSpace(_voiceId))
                    lines.Add("ElevenLabsVoiceId=" + Sanitize(_voiceId));

                File.WriteAllLines(ConfigPath, lines);
            }
            catch (Exception ex)
            {
                MelonLoader.MelonLogger.Warning("ElevenLabs config preservation write failed: " + ex.Message);
            }
        }
    }

    private static string Sanitize(string value)
    {
        return (value ?? "").Replace("\r", "").Replace("\n", "").Trim();
    }
}
