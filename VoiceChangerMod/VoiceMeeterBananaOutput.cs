using System;
using System.Collections.Generic;
using MelonLoader;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace VoiceChangerMod;

// Compatibility wrapper: Main.cs still calls DirectSoundOut, but this implementation
// uses Windows Core Audio/WASAPI so VoiceMeeter Banana's full virtual endpoint name
// is visible even when DirectSound does not expose it.
internal sealed class DirectSoundDeviceInfo
{
    internal Guid Guid { get; }
    internal string Description { get; }
    internal string ModuleName { get; }
    internal MMDevice Device { get; }

    internal DirectSoundDeviceInfo(Guid guid, MMDevice device)
    {
        Guid = guid;
        Device = device;
        Description = device.FriendlyName ?? string.Empty;
        ModuleName = device.DeviceFriendlyName ?? string.Empty;
    }
}

internal sealed class DirectSoundOut : IWavePlayer
{
    private static readonly object DeviceLock = new object();
    private static readonly Dictionary<Guid, MMDevice> DevicesByGuid = new Dictionary<Guid, MMDevice>();
    private readonly WasapiOut _inner;
    private readonly MMDevice _device;
    private bool _disposed;

    public static IEnumerable<DirectSoundDeviceInfo> Devices
    {
        get
        {
            var result = new List<DirectSoundDeviceInfo>();
            try
            {
                using (var enumerator = new MMDeviceEnumerator())
                {
                    foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.All))
                    {
                        string name = (device.FriendlyName ?? string.Empty).Trim();
                        string interfaceName = (device.DeviceFriendlyName ?? string.Empty).Trim();
                        MelonLogger.Msg("CoreAudio render device: " + name + " | " + interfaceName + " | " + device.State);

                        // Keep the MMDevice alive because WasapiOut needs the COM endpoint later.
                        Guid key = Guid.NewGuid();
                        lock (DeviceLock)
                        {
                            DevicesByGuid[key] = device;
                        }
                        result.Add(new DirectSoundDeviceInfo(key, device));
                    }
                }
            }
            catch (Exception ex)
            {
                MelonLogger.Error("CoreAudio device enumeration failed: " + ex.GetType().Name + ": " + ex.Message);
            }
            return result;
        }
    }

    public DirectSoundOut(Guid deviceGuid, int latency)
    {
        lock (DeviceLock)
        {
            if (!DevicesByGuid.TryGetValue(deviceGuid, out _device!))
                throw new InvalidOperationException("The selected Core Audio endpoint is no longer available.");
        }

        // Shared-mode WASAPI lets Windows/VoiceMeeter perform normal PCM format conversion.
        // Event sync avoids the old DirectSound/WaveOut buffering path.
        _inner = new WasapiOut(_device, AudioClientShareMode.Shared, true, Math.Max(20, latency));
    }

    public event EventHandler<StoppedEventArgs>? PlaybackStopped
    {
        add { _inner.PlaybackStopped += value; }
        remove { _inner.PlaybackStopped -= value; }
    }

    public PlaybackState PlaybackState => _inner.PlaybackState;
    public float Volume { get => _inner.Volume; set => _inner.Volume = value; }

    public void Init(IWaveProvider waveProvider) => _inner.Init(waveProvider);
    public void Play() => _inner.Play();
    public void Pause() => _inner.Pause();
    public void Stop() => _inner.Stop();

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { _inner.Dispose(); } catch { }
        try { _device.Dispose(); } catch { }
        lock (DeviceLock)
        {
            var remove = new List<Guid>();
            foreach (var pair in DevicesByGuid)
                if (ReferenceEquals(pair.Value, _device)) remove.Add(pair.Key);
            foreach (var key in remove) DevicesByGuid.Remove(key);
        }
    }
}
