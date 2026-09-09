from pathlib import Path
import re

path = Path('VoiceChangerMod/Main.cs')
text = path.read_text(encoding='utf-8-sig')

# WASAPI/CoreAudio gives us the real Windows playback endpoint names instead of
# relying on the legacy WaveOut device index/name list.
text = text.replace('using NAudio.Wave;\n', 'using NAudio.Wave;\nusing NAudio.CoreAudioApi;\n', 1)
text = re.sub(r'private const int OutputDeviceIndex = \d+;', 'private const string VoicemeeterPlaybackName = "Voicemeeter Input";', text, count=1)
text = text.replace('private static WaveOutEvent? _speaker;', 'private static IWavePlayer? _speaker;', 1)
text = text.replace('MelonLogger.Msg("TTS output device index = " + OutputDeviceIndex + " (Voicemeeter Banana target)");', 'MelonLogger.Msg("TTS target: Windows WASAPI VoiceMeeter playback endpoint");')
text = text.replace('private static bool _enabled;\n', 'private static bool _enabled;\n    private static volatile bool _suppressMicProcessing;\n', 1)
text = text.replace('if (type == "TurnInfo")\n            {\n                string? transcript = (string?)root["transcript"]; string? evt = (string?)root["event"];', 'if (type == "TurnInfo")\n            {\n                if (_suppressMicProcessing) return;\n                string? transcript = (string?)root["transcript"]; string? evt = (string?)root["event"];', 1)

old = '''    private static void PlayMp3(byte[] audio)
    {
        StopPlayback();
        _audioStream = new MemoryStream(audio, false);
        _reader = new Mp3FileReader(_audioStream);
        _speaker = new WaveOutEvent { DeviceNumber = OutputDeviceIndex };
        MelonLogger.Msg("Playing TTS through audio output device index " + OutputDeviceIndex + ".");
        _speaker.Init(_reader);
        _speaker.PlaybackStopped += (_, _) => { try { _speaker?.Dispose(); } catch { } try { _reader?.Dispose(); } catch { } try { _audioStream?.Dispose(); } catch { } _speaker = null; _reader = null; _audioStream = null; };
        _speaker.Play();
    }
'''
new = '''    private static void PlayMp3(byte[] audio)
    {
        StopPlayback();

        MMDeviceEnumerator enumerator = new MMDeviceEnumerator();
        MMDevice? device = null;
        try
        {
            MMDevice? fallback = null;
            foreach (var candidate in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
            {
                string name = candidate.FriendlyName ?? "";
                MelonLogger.Msg("WASAPI playback device: " + name + " | ID: " + candidate.ID);

                if (name.IndexOf(VoicemeeterPlaybackName, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    device = candidate;
                    break;
                }

                if (fallback == null &&
                    name.IndexOf("VoiceMeeter", StringComparison.OrdinalIgnoreCase) >= 0 &&
                    name.IndexOf("Input", StringComparison.OrdinalIgnoreCase) >= 0)
                    fallback = candidate;
            }

            device ??= fallback;
            if (device == null)
            {
                _status = "VoiceMeeter WASAPI endpoint not found";
                NativeGui.Refresh();
                enumerator.Dispose();
                return;
            }

            _suppressMicProcessing = true;
            _audioStream = new MemoryStream(audio, false);
            _reader = new Mp3FileReader(_audioStream);
            _speaker = new WasapiOut(device, AudioClientShareMode.Shared, true, 100);
            MelonLogger.Msg("Playing TTS through Windows WASAPI endpoint: " + device.FriendlyName);
            _speaker.Init(_reader);
            _speaker.PlaybackStopped += (_, _) =>
            {
                try { _speaker?.Dispose(); } catch { }
                try { _reader?.Dispose(); } catch { }
                try { _audioStream?.Dispose(); } catch { }
                try { device?.Dispose(); } catch { }
                try { enumerator.Dispose(); } catch { }
                _speaker = null;
                _reader = null;
                _audioStream = null;
                _suppressMicProcessing = false;
            };
            _speaker.Play();
        }
        catch
        {
            try { device?.Dispose(); } catch { }
            try { enumerator.Dispose(); } catch { }
            throw;
        }
    }
'''
if old not in text:
    raise SystemExit('Expected PlayMp3 block was not found; refusing to modify source.')
text = text.replace(old, new, 1)
text = text.replace('StopPlayback();\n        _status = "Disabled";', 'StopPlayback();\n        _suppressMicProcessing = false;\n        _status = "Disabled";', 1)
path.write_text(text, encoding='utf-8')
print('Configured Windows WASAPI VoiceMeeter playback detection, safe device lifetime, and TTS feedback suppression.')
