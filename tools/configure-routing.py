from pathlib import Path
import re

path = Path('VoiceChangerMod/Main.cs')
text = path.read_text(encoding='utf-8-sig')

text = re.sub(
    r'private const string (?:CableWindowsName|VoicemeeterWindowsName) = "[^"]*";',
    'private const string VoicemeeterWindowsName = "VoiceMeeter Input";',
    text,
    count=1,
)
text = text.replace(
    'private const int OutputDeviceIndex = 18;',
    'private const string VoicemeeterWindowsName = "VoiceMeeter Input";'
)

text = re.sub(
    r'MelonLogger\.Msg\("TTS target:.*?\);',
    'MelonLogger.Msg("TTS target: Windows playback device named VoiceMeeter Input (Voicemeeter Banana VAIO)");',
    text,
    count=1,
)
text = text.replace(
    'MelonLogger.Msg("TTS output device index = " + OutputDeviceIndex + " (Voicemeeter Banana target)");',
    'MelonLogger.Msg("TTS target: Windows playback device named VoiceMeeter Input (Voicemeeter Banana VAIO)");'
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

                bool isVoicemeeter = name.IndexOf("VoiceMeeter", StringComparison.OrdinalIgnoreCase) >= 0;
                bool isMainInput = name.IndexOf("Input", StringComparison.OrdinalIgnoreCase) >= 0;
                bool isAux = name.IndexOf("AUX", StringComparison.OrdinalIgnoreCase) >= 0;

                if (isVoicemeeter && isMainInput && !isAux)
                {
                    MelonLogger.Msg("Voicemeeter main virtual input found at WaveOut index " + i + ": " + name);
                    return i;
                }
            }
            catch (Exception ex)
            {
                MelonLogger.Warning("Could not inspect audio output " + i + ": " + ex.Message);
            }
        }

        MelonLogger.Error("Voicemeeter main virtual input was not found. Expected a Windows playback device containing 'VoiceMeeter' and 'Input', while excluding AUX.");
        return -1;
    }

    private static void PlayMp3(byte[] audio)
    {
        StopPlayback();
        int device = FindVoicemeeterBananaDevice();
        if (device < 0)
        {
            _status = "Voicemeeter Input not found";
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
            MelonLogger.Error("Could not play TTS through Voicemeeter: " + ex.GetType().Name + ": " + ex.Message);
            StopPlayback();
            _status = "Voicemeeter playback error";
            NativeGui.Refresh();
        }
    }'''

pattern = r'    private static (?:void PlayMp3|int FindCableInputDevice).*?\n    \}\n\n    private static void StopPlayback\(\)'
replacement = '    ' + new_method + '\n\n    private static void StopPlayback()'
updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
if count != 1:
    raise SystemExit('Expected existing audio playback section was not found; refusing to modify Main.cs.')

if 'OutputDeviceIndex' in updated:
    raise SystemExit('Old numeric output-device routing is still present.')
if 'FindCableInputDevice' in updated:
    raise SystemExit('Old VB-CABLE resolver is still present.')
if 'FindVoicemeeterBananaDevice' not in updated:
    raise SystemExit('Voicemeeter device resolver was not inserted.')

path.write_text(updated, encoding='utf-8')
print('Configured TTS routing for Windows playback device VoiceMeeter Input, excluding AUX.')
