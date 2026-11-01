# PocketWeb Dictation EXE

A small Windows app that attaches to an **already-open Chrome window** using Chrome DevTools Protocol. It runs Chrome's built-in `SpeechRecognition` in the PocketWebTools Voice Cloning tab, watches microphone audio level, and submits the final transcript after 2.5 seconds of silence.

## Important: Chrome must be started with remote debugging enabled

Chrome does not let an external program attach to an ordinary existing browser process. Start Chrome with remote debugging enabled, then use that same window as usual. The EXE does not create another Chrome window.

1. Close every Chrome window (Chrome must fully exit).
2. Run `Start-Chrome-Debug.bat` from this folder.
3. In the Chrome window it opens, visit [PocketWebTools Voice Cloning](https://pocketweb.tools/voice-cloning).
4. Run `PocketWebDictation.exe`, leave port at `9222`, and click **Start dictation**.
5. Allow microphone access for `pocketweb.tools` if Chrome asks.
6. Speak. After 2.5 seconds of microphone silence, the recognized words are placed in the TTS box and **Generate** is clicked. Listening resumes automatically.
7. Click **Stop** in the EXE to stop the microphone and recognition loop.

The batch file uses a dedicated Chrome profile in `%LOCALAPPDATA%\PocketWebDictation\ChromeProfile`. This is required by current Chrome security behavior for remote debugging. It does not overwrite your normal Chrome profile. Sign in to PocketWebTools in this debug Chrome profile if needed.

## Notes

- This uses Chrome's own Web Speech API for transcription. Chrome may use Google's online speech recognition service; it is not offline.
- The audio-level monitor uses `getUserMedia()`; SpeechRecognition is a separate browser API and cannot consume that exact audio stream.
- It does not click Play or use Windows text-to-speech.
- If the app says it cannot connect, check that Chrome was launched by the batch file and that the debugging port is still 9222.
- Only clone voices you own or have permission to use.
