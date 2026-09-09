from pathlib import Path
import re

path = Path('VoiceChangerMod/Main.cs')
text = path.read_text(encoding='utf-8-sig')

text = re.sub(r'private const int OutputDeviceIndex = \d+;', 'private const string VoicemeeterPlaybackName = "Voicemeeter Input";', text, count=1)
text = text.replace('MelonLogger.Msg("TTS output device index = " + OutputDeviceIndex + " (Voicemeeter Banana target)");', 'MelonLogger.Msg("TTS target: automatically detected VoiceMeeter playback device");')
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
new = '''    private static int FindVoicemeeterPlaybackDevice()
    {
        int fallback = -1;
        for (int i = 0; i < WaveOutEvent.DeviceCount; i++)
        {
            try
            {
                var caps = WaveOutEvent.GetCapabilities(i);
                string name = caps.ProductName ?? "";
                MelonLogger.Msg("Audio output " + i + ": " + name);
                if (name.IndexOf("Voicemeeter Input", StringComparison.OrdinalIgnoreCase) >= 0) return i;
                if (fallback < 0 && name.IndexOf("VoiceMeeter", StringComparison.OrdinalIgnoreCase) >= 0 && name.IndexOf("Input", StringComparison.OrdinalIgnoreCase) >= 0) fallback = i;
            }
            catch (Exception ex) { MelonLogger.Warning("Could not inspect audio output " + i + ": " + ex.Message); }
        }
        if (fallback >= 0) return fallback;
        MelonLogger.Error("VoiceMeeter playback device was not found. Expected a device containing 'Voicemeeter Input'.");
        return -1;
    }

    private static void PlayMp3(byte[] audio)
    {
        StopPlayback();
        int device = FindVoicemeeterPlaybackDevice();
        if (device < 0)
        {
            _status = "VoiceMeeter Input not found";
            NativeGui.Refresh();
            return;
        }
        _suppressMicProcessing = true;
        _audioStream = new MemoryStream(audio, false);
        _reader = new Mp3FileReader(_audioStream);
        _speaker = new WaveOutEvent { DeviceNumber = device };
        MelonLogger.Msg("Playing TTS through VoiceMeeter playback device at WaveOut index " + device + ".");
        _speaker.Init(_reader);
        _speaker.PlaybackStopped += (_, _) =>
        {
            try { _speaker?.Dispose(); } catch { }
            try { _reader?.Dispose(); } catch { }
            try { _audioStream?.Dispose(); } catch { }
            _speaker = null;
            _reader = null;
            _audioStream = null;
            _suppressMicProcessing = false;
        };
        _speaker.Play();
    }
'''
if old not in text: raise SystemExit('Expected PlayMp3 block was not found; refusing to modify source.')
text = text.replace(old, new, 1)
text = text.replace('StopPlayback();\n        _status = "Disabled";', 'StopPlayback();\n        _suppressMicProcessing = false;\n        _status = "Disabled";', 1)
path.write_text(text, encoding='utf-8')
print('Configured automatic VoiceMeeter detection and TTS feedback suppression.')
