from pathlib import Path
import re

path = Path('VoiceChangerMod/Main.cs')
text = path.read_text(encoding='utf-8-sig')

text = text.replace(
    'private const int OutputDeviceIndex = 18;',
    'private const string VoicemeeterWindowsName = "VoiceMeeter Input";'
)

text = text.replace(
    'MelonLogger.Msg("TTS output device index = " + OutputDeviceIndex + " (Voicemeeter Banana target)");',
    'MelonLogger.Msg("TTS target: Windows audio device named VoiceMeeter Input (Voicemeeter Banana default input)");'
)

new_method = '''private static int FindVoicemeeterBananaDevice()
    {
        for (int i = 0; i < WaveOut.DeviceCount; i++)
        {
            try
            {
                var caps = WaveOut.GetCapabilities(i);
                string name = caps.ProductName ?? "";
                MelonLogger.Msg("Audio output " + i + ": " + name);

                if (name.IndexOf(VoicemeeterWindowsName, StringComparison.OrdinalIgnoreCase) >= 0 &&
                    name.IndexOf("AUX", StringComparison.OrdinalIgnoreCase) < 0)
                {
                    MelonLogger.Msg("Voicemeeter Banana default Windows output found at WaveOut index " + i + ": " + name);
                    return i;
                }
            }
            catch (Exception ex)
            {
                MelonLogger.Warning("Could not inspect audio output " + i + ": " + ex.Message);
            }
        }

        MelonLogger.Error("Voicemeeter Banana default output was not found by Windows device name. Expected a device containing 'VoiceMeeter Input'.");
        return -1;
    }

    private static void PlayMp3(byte[] audio)
    {
        StopPlayback();
        int device = FindVoicemeeterBananaDevice();
        if (device < 0)
        {
            _status = "Voicemeeter Banana output not found";
            NativeGui.Refresh();
            return;
        }

        try
        {
            _audioStream = new MemoryStream(audio, false);
            _reader = new Mp3FileReader(_audioStream);
            _speaker = new WaveOutEvent { DeviceNumber = device };
            MelonLogger.Msg("Playing TTS through Windows device 'VoiceMeeter Input' at WaveOut index " + device + ".");
            _speaker.Init(_reader);
            _speaker.PlaybackStopped += (_, _) =>
            {
                try { _speaker?.Dispose(); } catch { }
                try { _reader?.Dispose(); } catch { }
                try { _audioStream?.Dispose(); } catch { }
                _speaker = null;
                _reader = null;
                _audioStream = null;
            };
            _speaker.Play();
        }
        catch (Exception ex)
        {
            MelonLogger.Error("Could not play TTS through Voicemeeter Banana: " + ex.GetType().Name + ": " + ex.Message);
            StopPlayback();
            _status = "Voicemeeter playback error";
            NativeGui.Refresh();
        }
    }'''

pattern = r'    private static void PlayMp3\(byte\[\] audio\)\n    \{.*?\n    \}\n\n    private static void StopPlayback\(\)'
replacement = '    ' + new_method + '\n\n    private static void StopPlayback()'

updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
if count != 1:
    raise SystemExit('Expected PlayMp3 method was not found; refusing to modify Main.cs.')

if 'OutputDeviceIndex' in updated:
    raise SystemExit('Old numeric output-device routing is still present.')
if 'FindVoicemeeterBananaDevice' not in updated:
    raise SystemExit('Voicemeeter device resolver was not inserted.')

path.write_text(updated, encoding='utf-8')
print('Configured TTS routing for Windows device name: VoiceMeeter Input (non-AUX).')
