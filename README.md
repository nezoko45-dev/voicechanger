# VoiceChanger PocketWeb Dictation — local microphone transcription

The extension captures audio from the computer's default microphone using `getUserMedia()` and `MediaRecorder`. It does **not** use Chrome's `SpeechRecognition` API. A local Faster-Whisper server transcribes recorded audio; no cloud transcription API is used.

## Requirements

- Desktop Chrome/Chromium
- Python 3.10+
- FFmpeg installed and available on PATH
- Internet access once to download the Faster-Whisper model

## Start the local transcription server

From the repository root:

```bash
python -m pip install -r requirements-local.txt
python local_transcriber.py
```

The first run downloads the `small` model. Inference then runs locally. The server binds only to `127.0.0.1:8178`. Set `WHISPER_MODEL=base` for a lighter/faster model or `WHISPER_MODEL=medium` for higher accuracy with greater compute/memory cost.

## Load and use the extension

1. Open `chrome://extensions`, enable Developer mode, and click **Load unpacked**.
2. Select the folder containing this branch's root `manifest.json`, `content.js`, `popup.html`, and `popup.js`.
3. Open [PocketWebTools Voice Cloning](https://pocketweb.tools/voice-cloning).
4. Start the local server, click the extension icon, then **Start listening**.
5. Allow microphone access if prompted. Speak a sentence and pause for 2.5 seconds. The extension transcribes locally, enters the sentence, clicks Generate, plays the result, then resumes listening. Use **Stop** to end.

## Troubleshooting

- Keep the local server terminal open. If the extension says the server is unavailable, run `python local_transcriber.py` and check port 8178.
- If microphone access fails, allow it for `pocketweb.tools` in Chrome site settings, reload the tab, and try again.
- FFmpeg is required to decode WebM audio.
- The initial model download can take a while; CPU-only transcription may have noticeable latency.
- Result Play-button detection depends on PocketWebTools' page markup and may need adjustment if their UI changes.

Audio is sent to `127.0.0.1` for local transcription. Model files download from Hugging Face on first launch.
