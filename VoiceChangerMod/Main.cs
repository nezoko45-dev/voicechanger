using MelonLoader;

[assembly: MelonInfo(typeof(VoiceChangerMod.Main), "ChilloutVR VoiceChanger Mod", "2.0.0", "nezoko45-dev")]

namespace VoiceChangerMod;

public sealed class Main : MelonMod
{
    public override void OnApplicationStart()
    {
        MelonLogger.Msg("ChilloutVR VoiceChanger browser mode loaded.");
        MelonLogger.Msg("Press F8 to open the browser voice changer.");
    }

    public override void OnUpdate()
    {
        // BrowserController owns F8 and all voice processing.
        // No Unity/native GUI or legacy audio playback is used.
    }
}
