using System;
using MelonLoader;
using NAudio.Wave;

namespace VoiceChangerMod;

// Compatibility wrapper: Main.cs still constructs WaveOutEvent, but TTS is redirected
// from VB-CABLE to VoiceMeeter Potato's Virtual AUX input.
internal sealed class WaveOutEvent : IDisposable
{
    private static readonly string[] PreferredNames = new[]
    {
        "Voicemeeter AUX Input",
        "VoiceMeeter AUX Input"
    };

    private readonly NAudio.Wave.WaveOutEvent _inner = new NAudio.Wave.WaveOutEvent();

    public int DeviceNumber { get; set; } = -1;

    public event EventHandler<StoppedEventArgs>? PlaybackStopped;

    public void Init(IWaveProvider provider)
    {
        int device = FindVoiceMeeterAuxInput();
        if (device < 0)
            throw new InvalidOperationException("Could not find VoiceMeeter AUX Input. Make sure VoiceMeeter Potato is running.");

        _inner.DeviceNumber = device;
        _inner.BufferMilliseconds = 40;
        _inner.NumberOfBuffers = 2;
        _inner.PlaybackStopped += InnerPlaybackStopped;

        MelonLogger.Msg("Direct TTS route: Deepgram WAV -> VoiceMeeter AUX Input (Potato Virtual AUX / index 18).");
        MelonLogger.Msg("VoiceMeeter Windows playback device = [" + device + "]");
        _inner.Init(provider);
    }

    public void Play() => _inner.Play();

    public void Stop() => _inner.Stop();

    public void Dispose()
    {
        try { _inner.PlaybackStopped -= InnerPlaybackStopped; } catch { }
        _inner.Dispose();
    }

    private void InnerPlaybackStopped(object? sender, StoppedEventArgs e)
    {
        PlaybackStopped?.Invoke(this, e);
    }

    private static int FindVoiceMeeterAuxInput()
    {
        for (int i = 0; i < NAudio.Wave.WaveOut.DeviceCount; i++)
        {
            WaveOutCapabilities caps;
            try { caps = NAudio.Wave.WaveOut.GetCapabilities(i); }
            catch { continue; }

            string name = caps.ProductName ?? string.Empty;
            MelonLogger.Msg("WaveOut playback device [" + i + "]: " + name);

            for (int n = 0; n < PreferredNames.Length; n++)
            {
                if (name.IndexOf(PreferredNames[n], StringComparison.OrdinalIgnoreCase) >= 0)
                    return i;
            }
        }

        return -1;
    }
}
