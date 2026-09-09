from pathlib import Path

SOURCE = Path("VoiceChangerMod/Main.cs")


def fail(message: str) -> None:
    raise SystemExit("Routing patch failed: " + message)


text = SOURCE.read_text(encoding="utf-8-sig")
original = text

# 1. Add CoreAudio/WASAPI support exactly once.
if "using NAudio.CoreAudioApi;" not in text:
    anchor = "using NAudio.Wave;\n"
    if anchor not in text:
        fail("could not find the NAudio.Wave using directive")
    text = text.replace(anchor, anchor + "using NAudio.CoreAudioApi;\n", 1)

# 2. Replace the old numeric output-device setting with a stable Windows
#    playback-endpoint name. CABLE Input is the playback side of VB-CABLE.
old_constant = "    private const int OutputDeviceIndex = 18;"
new_constant = '    private const string CablePlaybackName = "CABLE Input";'
if old_constant in text:
    text = text.replace(old_constant, new_constant, 1)
elif 'private const string CablePlaybackName = "CABLE Input";' not in text:
    fail("could not find the old output-device constant")

# 3. Make Deepgram explicitly return MP3 because PlayMp3 uses Mp3FileReader.
url_prefix = '            string url = "https://api.deepgram.com/v1/speak?model=" + Uri.EscapeDataString(Voices[_selectedVoice].Model)'
if url_prefix in text:
    text = text.replace(
        url_prefix,
        url_prefix + ' + "&encoding=mp3"',
        1,
    )
elif '&encoding=mp3"' not in text:
    fail("could not find the Deepgram TTS URL line")

# 4. Update the startup diagnostic without touching unrelated code.
old_log = '        MelonLogger.Msg("TTS output device index = " + OutputDeviceIndex + " (Voicemeeter Banana target)");'
new_log = '        MelonLogger.Msg("TTS output endpoint = " + CablePlaybackName + " (VB-CABLE -> VoiceMeeter)");'
if old_log in text:
    text = text.replace(old_log, new_log, 1)
elif 'TTS output endpoint = ' not in text:
    fail("could not find the old TTS startup log")

# 5. Use the common NAudio playback interface so WasapiOut can be assigned.
old_speaker = "    private static WaveOutEvent? _speaker;"
new_speaker = "    private static IWavePlayer? _speaker;"
if old_speaker in text:
    text = text.replace(old_speaker, new_speaker, 1)
elif "private static IWavePlayer? _speaker;" not in text:
    fail("could not find the speaker field")

# 6. Add a guard that prevents TTS from being fed back into Deepgram.
if "private static volatile bool _suppressMicProcessing;" not in text:
    marker = "    private static bool _enabled;\n"
    if marker not in text:
        fail("could not find the enabled-state field")
    text = text.replace(
        marker,
        marker + "    private static volatile bool _suppressMicProcessing;\n",
        1,
    )

handle_anchor = '            if (type == "TurnInfo")\n            {\n'
if "if (_suppressMicProcessing) return;" not in text:
    if handle_anchor not in text:
        fail("could not find the Flux TurnInfo handler")
    text = text.replace(
        handle_anchor,
        handle_anchor + "                if (_suppressMicProcessing) return;\n",
        1,
    )

# 7. Replace ONLY the two playback methods. Boundary-based replacement keeps
#    the rest of Main.cs untouched and makes the patch idempotent.
play_marker = "    private static void PlayMp3(byte[] audio)"
stop_marker = "    private static void StopPlayback()"
play_start = text.find(play_marker)
stop_start = text.find(stop_marker, play_start + len(play_marker))
if play_start < 0 or stop_start < 0 or stop_start <= play_start:
    fail("could not find the PlayMp3/StopPlayback method boundaries")

new_play = '''    private static void PlayMp3(byte[] audio)
    {
        StopPlayback();

        MMDeviceEnumerator enumerator = new MMDeviceEnumerator();
        MMDevice? device = null;

        try
        {
            foreach (MMDevice candidate in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
            {
                MelonLogger.Msg("WASAPI playback device: " + candidate.FriendlyName);

                if ((candidate.FriendlyName ?? "").IndexOf(CablePlaybackName, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    device = candidate;
                    break;
                }

                candidate.Dispose();
            }

            if (device == null)
            {
                _status = "VB-CABLE Input not found";
                NativeGui.Refresh();
                MelonLogger.Error("Could not find the Windows playback endpoint named '" + CablePlaybackName + "'.");
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

            MelonLogger.Msg("Playing Deepgram MP3 TTS through VB-CABLE Input -> CABLE Output -> VoiceMeeter.");
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

# Ensure StopPlayback clears the feedback guard even if playback is stopped
# manually (F9/F10 or a reconnect).
stop_body_start = text.find(stop_marker)
stop_body_end = text.find("    }", stop_body_start)
if stop_body_start < 0 or stop_body_end < 0:
    fail("could not locate StopPlayback body")
stop_body = text[stop_body_start:stop_body_end]
if "_suppressMicProcessing = false;" not in stop_body:
    text = text[:stop_body_end] + "        _suppressMicProcessing = false;\n" + text[stop_body_end:]

# 8. Final safety checks. Refuse to write if the old routing survived or if
#    the new playback implementation was not installed.
if "OutputDeviceIndex" in text:
    fail("old OutputDeviceIndex reference remains")
if "new WaveOutEvent" in text:
    fail("old WaveOut playback construction remains")
if "new WasapiOut(device, AudioClientShareMode.Shared, true, 100)" not in text:
    fail("new WASAPI playback construction is missing")
if '"&encoding=mp3"' not in text:
    fail("Deepgram MP3 encoding parameter is missing")
if "private static IWavePlayer? _speaker;" not in text:
    fail("IWavePlayer speaker field is missing")

if text == original:
    print("Routing source is already configured; no changes needed.")
else:
    SOURCE.write_text(text, encoding="utf-8")
    print("Routing configured successfully: Deepgram MP3 -> VB-CABLE Input -> CABLE Output -> VoiceMeeter.")
