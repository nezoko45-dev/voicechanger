from pathlib import Path

SOURCE = Path("VoiceChangerMod/Main.cs")
text = SOURCE.read_text(encoding="utf-8-sig")


def fail(message: str):
    raise SystemExit("TTS/routing patch failed: " + message)

# Keep the patch deterministic: modify only known declarations, the Deepgram
# TTS request, and the two playback methods. Never rewrite the whole source.

# Imports
if "using NAudio.CoreAudioApi;" not in text:
    anchor = "using NAudio.Wave;\n"
    if anchor not in text:
        fail("NAudio.Wave import not found")
    text = text.replace(anchor, anchor + "using NAudio.CoreAudioApi;\n", 1)

# Stable Windows playback endpoint instead of a fragile numeric device index.
old = "    private const int OutputDeviceIndex = 18;"
new = '    private const string CablePlaybackName = "CABLE Input";'
if old in text:
    text = text.replace(old, new, 1)
elif 'private const string CablePlaybackName = "CABLE Input";' not in text:
    fail("output device declaration not found")

# WASAPI can be assigned through IWavePlayer.
old = "    private static WaveOutEvent? _speaker;"
new = "    private static IWavePlayer? _speaker;"
if old in text:
    text = text.replace(old, new, 1)
elif "private static IWavePlayer? _speaker;" not in text:
    fail("speaker declaration not found")

# WAV playback needs a WaveStream-compatible reader rather than Mp3FileReader.
old = "    private static Mp3FileReader? _reader;"
new = "    private static WaveFileReader? _reader;"
if old in text:
    text = text.replace(old, new, 1)
elif "private static WaveFileReader? _reader;" not in text:
    fail("audio reader declaration not found")

# Prevent generated TTS from being treated as microphone input.
if "private static volatile bool _suppressMicProcessing;" not in text:
    marker = "    private static bool _enabled;\n"
    if marker not in text:
        fail("enabled declaration not found")
    text = text.replace(marker, marker + "    private static volatile bool _suppressMicProcessing;\n", 1)

handle = '            if (type == "TurnInfo")\n            {\n'
if "if (_suppressMicProcessing) return;" not in text:
    if handle not in text:
        fail("TurnInfo handler not found")
    text = text.replace(handle, handle + "                if (_suppressMicProcessing) return;\n", 1)

# Explicitly request uncompressed WAV from Deepgram. This avoids MP3 decoder
# differences between Windows/NAudio installations. Deepgram supports
# linear16 + WAV on REST TTS.
old_url = '            string url = "https://api.deepgram.com/v1/speak?model=" + Uri.EscapeDataString(Voices[_selectedVoice].Model);'
new_url = '            string url = "https://api.deepgram.com/v1/speak?model=" + Uri.EscapeDataString(Voices[_selectedVoice].Model) + "&encoding=linear16&container=wav";'
if old_url in text:
    text = text.replace(old_url, new_url, 1)
elif 'encoding=linear16&container=wav' not in text:
    fail("Deepgram TTS URL not found")

# Replace the playback implementation by method boundaries only.
play_marker = "    private static void PlayMp3(byte[] audio)"
stop_marker = "    private static void StopPlayback()"
start = text.find(play_marker)
end = text.find(stop_marker, start + len(play_marker))
if start < 0 or end < 0 or end <= start:
    fail("TTS playback method boundaries not found")

new_play = '''    private static void PlayMp3(byte[] audio)\n    {\n        StopPlayback();\n\n        MMDeviceEnumerator enumerator = new MMDeviceEnumerator();\n        MMDevice? device = null;\n\n        try\n        {\n            foreach (MMDevice candidate in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))\n            {\n                string name = candidate.FriendlyName ?? "";\n                MelonLogger.Msg("WASAPI playback device: " + name);\n\n                if (name.IndexOf(CablePlaybackName, StringComparison.OrdinalIgnoreCase) >= 0)\n                {\n                    device = candidate;\n                    break;\n                }\n\n                candidate.Dispose();\n            }\n\n            if (device == null)\n            {\n                _status = "VB-CABLE Input not found";\n                NativeGui.Refresh();\n                MelonLogger.Error("Could not find Windows playback endpoint '" + CablePlaybackName + "'.");\n                enumerator.Dispose();\n                return;\n            }\n\n            _suppressMicProcessing = true;\n            _audioStream = new MemoryStream(audio, false);\n            _reader = new WaveFileReader(_audioStream);\n            _speaker = new WasapiOut(device, AudioClientShareMode.Shared, true, 100);\n            _speaker.Init(_reader);\n\n            _speaker.PlaybackStopped += (_, e) =>\n            {\n                if (e.Exception != null)\n                    MelonLogger.Error("TTS playback stopped with error: " + e.Exception.Message);\n\n                try { _speaker?.Dispose(); } catch { }\n                try { _reader?.Dispose(); } catch { }\n                try { _audioStream?.Dispose(); } catch { }\n                try { device?.Dispose(); } catch { }\n                try { enumerator.Dispose(); } catch { }\n                _speaker = null;\n                _reader = null;\n                _audioStream = null;\n                _suppressMicProcessing = false;\n            };\n\n            MelonLogger.Msg("Playing Deepgram WAV TTS through VB-CABLE Input -> CABLE Output -> VoiceMeeter.");\n            _speaker.Play();\n        }\n        catch (Exception ex)\n        {\n            _status = "TTS playback failed";\n            NativeGui.Refresh();\n            MelonLogger.Error("TTS playback failed: " + ex.GetType().Name + ": " + ex.Message);\n            try { _speaker?.Dispose(); } catch { }\n            try { _reader?.Dispose(); } catch { }\n            try { _audioStream?.Dispose(); } catch { }\n            try { device?.Dispose(); } catch { }\n            try { enumerator.Dispose(); } catch { }\n            _speaker = null;\n            _reader = null;\n            _audioStream = null;\n            _suppressMicProcessing = false;\n        }\n    }\n\n'''
text = text[:start] + new_play + text[end:]

# Ensure manual stop also releases the feedback guard.
stop_start = text.find(stop_marker)
stop_end = text.find("    }", stop_start)
if stop_start < 0 or stop_end < 0:
    fail("StopPlayback method not found")
stop_body = text[stop_start:stop_end]
if "_suppressMicProcessing = false;" not in stop_body:
    text = text[:stop_end] + "        _suppressMicProcessing = false;\n" + text[stop_end:]

# Update only the diagnostic string if the old one exists.
old_log = '        MelonLogger.Msg("TTS output device index = " + OutputDeviceIndex + " (Voicemeeter Banana target)");'
new_log = '        MelonLogger.Msg("TTS output endpoint = " + CablePlaybackName + " (VB-CABLE -> VoiceMeeter)");'
if old_log in text:
    text = text.replace(old_log, new_log, 1)

# Hard safety checks before writing.
required = [
    'private const string CablePlaybackName = "CABLE Input";',
    'private static IWavePlayer? _speaker;',
    'private static WaveFileReader? _reader;',
    'encoding=linear16&container=wav',
    'new WasapiOut(device, AudioClientShareMode.Shared, true, 100)',
    '_reader = new WaveFileReader(_audioStream);',
    'private static volatile bool _suppressMicProcessing;'
]
for item in required:
    if item not in text:
        fail("required TTS code is missing: " + item)

if "OutputDeviceIndex" in text:
    fail("old OutputDeviceIndex reference remains")
if "new WaveOutEvent" in text:
    fail("old WaveOut playback remains")
if "Mp3FileReader" in text:
    fail("old MP3 reader declaration remains")

SOURCE.write_text(text, encoding="utf-8")
print("TTS fixed: Deepgram -> explicit WAV -> WASAPI CABLE Input -> CABLE Output -> VoiceMeeter.")
