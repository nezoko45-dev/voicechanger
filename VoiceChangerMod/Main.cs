using MelonLoader;

[assembly: MelonInfo(typeof(VoiceChangerMod.Main), "ChilloutVR VoiceChanger Mod", "2.0.0", "nezoko45-dev")]

namespace VoiceChangerMod;

public sealed class Main : MelonMod
{
    public override void OnApplicationStart()
    {
        MelonLogger.Msg("ChilloutVR VoiceChanger browser mode loaded.");
        BrowserController.Start();
    }

    public override void OnUpdate()
    {
        BrowserController.Update();
    }
}
