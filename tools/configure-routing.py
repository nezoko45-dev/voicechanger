from pathlib import Path
import re

path = Path('VoiceChangerMod/Main.cs')
text = path.read_text(encoding='utf-8-sig')

text = re.sub(
    r'private const string VoicemeeterWindowsName = "[^"]*";',
    'private const string CableWindowsName = "CABLE Input";',
    text,
    count=1,
)
text = text.replace(
    'private const int OutputDeviceIndex = 18;',
    'private const string CableWindowsName = "CABLE Input";'
)

text = re.sub(
    r'MelonLogger\.Msg\("TTS target:.*?\);',
    'MelonLogger.Msg("TTS target: Windows playback device named CABLE Input (VB-Audio Virtual Cable)");',
    text,
    count=1,
)
text = text.replace(
    'MelonLogger.Msg("TTS output device index = " + OutputDeviceIndex + " (Voicemeeter Banana target)");',
    'MelonLogger.Msg("TTS target: Windows playback device named CABLE Input (VB-Audio Virtual Cable)");'
)

new_method = '''private static int FindCableInputDevice()
    {
        for (int i = 0; i < WaveOut.DeviceCount; i++)
        {
            try
            {
                var caps = WaveOut.GetCapabilities(i);
                string name = caps.ProductName ?? "";
                MelonLogger.Msg("Audio output " + i + ": " + name);

                if (name.IndexOf(CableWindowsName, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    MelonLogger.Msg("VB-CABLE playback device found at WaveOut index " + i + ": " + name);
                    return i;
                }
            }
            catch (Exception ex)
            {
                MelonLogger.Warning("Could not inspect audio output " + i + ": " + ex.Message);
            }
        }

        MelonLogger.Error("VB-CABLE playback device was not found. Expected a Windows playback device containing 'CABLE Input'. Note: CABLE Output is the recording side and cannot be selected by WaveOut for playback.");
        return -1;
    }

    private static void PlayMp3(byte[] audio)
    {
        StopPlayback();
        int device = FindCableInputDevice();
        if (device < 0)
        {
            _status = "VB-CABLE Input not found";
            NativeGui.Refresh();
            return;
        }

        try
        {
            _audioStream = new MemoryStream(audio, false);
            _reader = new Mp3FileReader(_audioStream);
            _speaker = new WaveOutEvent { DeviceNumber = device };
            MelonLogger.Msg("Playing TTS through Windows device 'CABLE Input' at WaveOut index " + device + ".");
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
            MelonLogger.Error("Could not play TTS through VB-CABLE: " + ex.GetType().Name + ": " + ex.Message);
            StopPlayback();
            _status = "VB-CABLE playback error";
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
if 'Voicemeeter' in updated or 'VoiceMeeter' in updated:
    raise SystemExit('Old Voicemeeter routing is still present.')
if 'FindCableInputDevice' not in updated:
    raise SystemExit('VB-CABLE device resolver was not inserted.')

path.write_text(updated, encoding='utf-8')
print('Configured TTS routing for Windows playback device name: CABLE Input (VB-Audio Virtual Cable).')
