# Character.AI Voice Dictation — Local Whisper

This extension captures the computer's **default microphone** with `getUserMedia()` and sends short WAV utterances to a Whisper model running on your own PC. It does not use Chrome's speech-recognition service. Transcription happens locally after the model has been downloaded.

## One-time setup (Windows)
1. Install Python 3.10 or newer from https://www.python.org/downloads/windows/ if it is not already installed. Enable the Python launcher.
2. Open the `cai-dictation` folder from this repository.
3. Double-click `start_local_transcriber.bat`. It creates a private `.venv`, installs dependencies, and downloads the `base.en` Whisper model on first launch. Keep the terminal open while dictating.
4. In Chrome, open `chrome://extensions`, enable Developer mode, then **Load unpacked** and choose the `cai-dictation` folder. If already installed, click **Reload**.
5. Refresh your Character.AI chat, allow microphone access, and click the extension icon → **Start dictation**.

## How it behaves
- Captures the Windows default input device (no device ID is specified).
- Uses local voice-activity detection and waits for about 1.2 seconds of silence before transcribing.
- Adds `repeat` at the start of a new message and automatically clicks Send after transcription.
- Click **Stop dictation** to release the microphone.
- After setup and model download, speech audio is sent only to the local service at `127.0.0.1`; the service binds to loopback, not your network interface.

## Notes
- The local service must remain running while dictating. Close its terminal to stop it.
- First install requires internet to download Python packages and the Whisper model. Subsequent transcription can run offline, provided the dependencies and model remain installed.
- This version uses the English `base.en` model and CPU inference. Transcription speed depends on your PC.
- Browser microphone permission still applies. This uses the operating system's default input selected by Windows/Chrome.
- Character.AI may change its composer or Send button markup. Automatic sending has not been live-tested on your account.
