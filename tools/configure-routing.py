from pathlib import Path
import re

path = Path('VoiceChangerMod/Main.cs')
text = path.read_text(encoding='utf-8-sig')

# Deepgram Speak defaults are not guaranteed to be MP3. The mod uses
# Mp3FileReader, so explicitly request MP3 to prevent playback failures.
text = re.sub(
    r'"https://api\.deepgram\.com/v1/speak\?model=" \+ Uri\.EscapeDataString\(Voices\[_selectedVoice\]\.Model\)',
    '"https://api.deepgram.com/v1/speak?model=" + Uri.EscapeDataString(Voices[_selectedVoice].Model) + "&encoding=mp3"',
    text,
    count=1,
)

if '&encoding=mp3' not in text:
    raise SystemExit('Could not configure Deepgram TTS for MP3 output; refusing to modify source.')

# Route generated TTS through the VB-CABLE playback endpoint (CABLE Input).
# Windows exposes that signal as CABLE Output for VoiceMeeter to receive.
if 'using NAudio.CoreAudioApi;' not in text:
    text = text.replace('using NAudio.Wave;\n', 'using NAudio.Wave;\nusing NAudio.CoreAudioApi;\n', 1)

text = re.sub(
    r'private const int OutputDeviceIndex = \d+;',
    'private const string CablePlaybackName = "CABLE Input";',
    text,
    count=1,
)

if 'private const string CablePlaybackName' not in text:
    raise SystemExit('Could not locate the TTS output-device constant; refusing to modify source.')

# The startup log used the old numeric output constant. Update it to the
# new endpoint name so the generated source always compiles.
text = re.sub(
    r'TTS output device index = " \+ OutputDeviceIndex \+ " \(Voicemeeter Banana target\)"',
    'TTS output endpoint = " + CablePlaybackName + " (VB-CABLE -> VoiceMeeter)"',
    text,
    count=1,
)

if 'OutputDeviceIndex' in text:
    raise SystemExit('OutputDeviceIndex reference remains after routing patch; refusing to modify source.')

text = re.sub(
    r'private static WaveOutEvent\? _speaker;',
    'private static IWavePlayer? _speaker;',
    text,
    count=1,
)

if 'private static IWavePlayer? _speaker;' not in text:
    raise SystemExit('Could not update the TTS speaker field; refusing to modify source.')

if 'private static volatile bool _suppressMicProcessing;' not in text:
    text = text.replace(
        'private static bool _enabled;\n',
        'private static bool _enabled;\n    private static volatile bool _suppressMicProcessing;\n',
        1,
    )

if 'if (_suppressMicProcessing) return;' not in text:
    text = text.replace(
        'if (type == "TurnInfo")\n            {\n                string? transcript = (string?)root["transcript"]; string? evt = (string?)root["event"];',
        'if (type == "TurnInfo")\n            {\n                if (_suppressMicProcessing) return;\n                string? transcript = (string?)root["transcript"]; string? evt = (string?)root["event"];',
        1,
    )

play_start = text.find('    private static void PlayMp3(byte[] audio)')
stop_start = text.find('    private static void StopPlayback()', play_start)
if play_start < 0 or stop_start < 0 or stop_start <= play_start:
    raise SystemExit('Could not locate PlayMp3/StopPlayback boundaries; refusing to modify source.')

new_play = '''    private static void PlayMp3(byte[] audio)
    {
        StopPlayback();

        MMDeviceEnumerator enumerator = new MMDeviceEnumerator();
        MMDevice? device = null;
        try
        {
            foreach (var candidate in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
            {
                string name = candidate.FriendlyName ?? "";
                MelonLogger.Msg("WASAPI playback device: " + name + " | ID: " + candidate.ID);

                if (name.IndexOf(CablePlaybackName, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    device = candidate;
                    break;
                }
            }

            if (device == null)
            {
                _status = "VB-CABLE Input endpoint not found";
                NativeGui.Refresh();
                enumerator.Dispose();
                return;
            }

            _suppressMicProcessing = true;
            _audioStream = new MemoryStream(audio, false);
            _reader = new Mp3FileReader(_audioStream);
            _speaker = new WasapiOut(device, AudioClientShareMode.Shared, true, 100);
            _speaker.Init(_reader);
            _speaker.PlaybackStopped += (_, e) =>
            {
                if (e.Exception != null)
                    MelonLogger.Error("TTS playback stopped with error: " + e.Exception.Message);
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
            MelonLogger.Msg("Playing MP3 TTS through VB-CABLE Input; VoiceMeeter should receive it on CABLE Output.");
            _speaker.Play();
        }
        catch (Exception ex)
        {
            _status = "TTS playback failed";
            NativeGui.Refresh();
            MelonLogger.Error("TTS playback failed: " + ex.GetType().Name + ": " + ex.Message);
            try { _speaker?.Dispose(); } catch { }
            try { _reader?.Dispose(); } catch { }
            try { _audioStream?.Dispose(); } catch { }
            try { device?.Dispose(); } catch { }
            try { enumerator.Dispose(); } catch { }
            _speaker = null;
            _reader = null;
            _audioStream = null;
            _suppressMicProcessing = false;
        }
    }

'''
text = text[:play_start] + new_play + text[stop_start:]

text = text.replace(
    '        _speaker = null; _reader = null; _audioStream = null;\n    }\n}',
    '        _speaker = null; _reader = null; _audioStream = null;\n        _suppressMicProcessing = false;\n    }\n}',
    1,
)

path.write_text(text, encoding='utf-8')
print('Configured Deepgram MP3 TTS -> VB-CABLE Input -> CABLE Output -> VoiceMeeter routing with feedback suppression.')
