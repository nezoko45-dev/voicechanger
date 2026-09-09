using System;
using System.Collections.Generic;
using MelonLoader;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace VoiceChangerMod;

// Core Audio compatibility layer. Main.cs keeps its existing DirectSoundOut calls,
// while this implementation enumerates the real Windows render endpoints so the
// full VoiceMeeter Banana virtual-input name is available.
internal sealed class DirectSoundDeviceInfo
{
    internal Guid Guid { get; }
    internal string Description { get; }
    internal string ModuleName { get; }

    internal DirectSoundDeviceInfo(Guid guid, MMDevice device)
    {
        Guid = guid;
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
                    var endpoints = enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active);
                    foreach (MMDevice device in endpoints)
                    {
                        string name = (device.FriendlyName ?? string.Empty).Trim();
                        string interfaceName = (device.DeviceFriendlyName ?? string.Empty).Trim();
                        MelonLogger.Msg("CoreAudio render device: " + name + " | " + interfaceName);

                        // Use a private key instead of converting the Windows endpoint ID to a Guid.
                        // The real MMDevice is retained until playback finishes.
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
        MMDevice selected;
        lock (DeviceLock)
        {
            if (!DevicesByGuid.TryGetValue(deviceGuid, out selected))
                throw new InvalidOperationException("The selected Core Audio endpoint is no longer available.");
        }

        _device = selected;
        // Shared-mode WASAPI lets Windows handle the endpoint's configured mix format.
        _inner = new WasapiOut(_device, AudioClientShareMode.Shared, true, Math.Max(20, latency));
    }

    public event EventHandler<StoppedEventArgs> PlaybackStopped
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
            foreach (Guid key in remove) DevicesByGuid.Remove(key);
        }
    }
}
