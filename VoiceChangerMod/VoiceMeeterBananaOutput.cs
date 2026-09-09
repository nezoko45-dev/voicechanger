using System;
using System.Collections.Generic;
using MelonLoader;
using NAudio.Wave;

namespace VoiceChangerMod;

// Compatibility layer used by Main.cs. It now deliberately targets the free
// VB-CABLE playback endpoint instead of VoiceMeeter directly. Windows routes
// audio sent to CABLE Input through VB-CABLE to CABLE Output, which VoiceMeeter
// Banana can then receive.
internal sealed class DirectSoundDeviceInfo
{
    internal int DeviceNumber { get; }
    internal string Description { get; }
    internal string ModuleName { get; }
    internal Guid Guid => Guid.Empty;

    internal DirectSoundDeviceInfo(int deviceNumber, string description)
    {
        DeviceNumber = deviceNumber;
        Description = description;
        ModuleName = "VB-Audio CABLE";
    }
}

internal sealed class DirectSoundOut : IWavePlayer
{
    private readonly WaveOutEvent _inner;

    public static IEnumerable<DirectSoundDeviceInfo> Devices
    {
        get
        {
            var result = new List<DirectSoundDeviceInfo>();
            try
            {
                for (int i = 0; i < WaveOut.DeviceCount; i++)
                {
                    WaveOutCapabilities caps = WaveOut.GetCapabilities(i);
                    string name = caps.ProductName ?? string.Empty;
                    MelonLogger.Msg("VB-CABLE/WaveOut playback device [" + i + "]: " + name);

                    // The player endpoint is CABLE Input. CABLE Output is the
                    // recording endpoint and is not a valid playback target.
                    if (name.IndexOf("CABLE Input", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        result.Add(new DirectSoundDeviceInfo(i, name));
                    }
                }
            }
            catch (Exception ex)
            {
                MelonLogger.Error("VB-CABLE playback enumeration failed: " + ex.GetType().Name + ": " + ex.Message);
            }

            return result;
        }
    }

    public DirectSoundOut(Guid ignoredDeviceGuid, int latency)
    {
        int deviceNumber = FindCableInputDeviceNumber();
        if (deviceNumber < 0)
            throw new InvalidOperationException("VB-CABLE CABLE Input playback endpoint is not available.");

        _inner = new WaveOutEvent
        {
            DeviceNumber = deviceNumber,
            DesiredLatency = Math.Max(20, latency),
            NumberOfBuffers = 2
        };

        MelonLogger.Msg("VB-CABLE playback selected: CABLE Input, device " + deviceNumber + ", target latency " + Math.Max(20, latency) + " ms.");
    }

    private static int FindCableInputDeviceNumber()
    {
        for (int i = 0; i < WaveOut.DeviceCount; i++)
        {
            WaveOutCapabilities caps = WaveOut.GetCapabilities(i);
            string name = caps.ProductName ?? string.Empty;
            if (name.IndexOf("CABLE Input", StringComparison.OrdinalIgnoreCase) >= 0)
                return i;
        }

        return -1;
    }

    public event EventHandler<StoppedEventArgs> PlaybackStopped
    {
        add { _inner.PlaybackStopped += value; }
        remove { _inner.PlaybackStopped -= value; }
    }

    public PlaybackState PlaybackState => _inner.PlaybackState;
    public WaveFormat OutputWaveFormat => _inner.OutputWaveFormat;
    public float Volume { get => _inner.Volume; set => _inner.Volume = value; }

    public void Init(IWaveProvider waveProvider) => _inner.Init(waveProvider);
    public void Play() => _inner.Play();
    public void Pause() => _inner.Pause();
    public void Stop() => _inner.Stop();

    public void Dispose()
    {
        try { _inner.Dispose(); } catch { }
    }
}
