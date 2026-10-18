# VoiceChanger — voiceclonnx Chrome extension

A minimal Chrome extension with one manually selected **reference voice** and an automatically created **source recording**. Audio conversion runs in a local Python service powered by [voiceclonnx](https://github.com/TigreGotico/voiceclonnx).

## Requirements
- Chrome or Chromium
- Python 3.10+
- A microphone
- Permission to use the reference speaker's voice

## Start the local conversion service (easy setup)
- **Windows:** double-click `start_backend.bat`.
- **macOS/Linux:** run `./start_backend.sh` from the repository folder. If needed, first run `chmod +x start_backend.sh`.

The launcher creates a `.venv` virtual environment, installs/updates `backend/requirements.txt`, then starts the service on `http://127.0.0.1:8765`. Keep its terminal window open while using the extension. Python 3.10+ must be installed first. The first conversion may download ONNX model files.

Manual alternative:
```bash
python -m venv .venv
pip install -r backend/requirements.txt
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

## Load the extension
1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose the repository root folder (the folder containing `manifest.json`).
4. Keep the local backend running at `http://127.0.0.1:8765`.

## Use
1. Pick a reference audio file (WAV, MP3, M4A, OGG, or another browser-decodable audio format).
2. Press **Record source**, speak, then press **Stop recording**. The source WAV is created automatically in memory; there is no second file picker.
3. Press **Convert voice** and save the resulting WAV.

Audio is sent only to the local service at 127.0.0.1. This starter does not record browser-tab audio; it records microphone input. Use only reference recordings you have permission to use.

## Notes
- Browser support for decoding input reference formats varies. WAV is the most reliable.
- The extension is a UI client; voiceclonnx is a Python ONNX library and does not run directly inside Chrome.
- The service is intended for local development, not public exposure. Do not bind it to a public interface without adding authentication and security controls.
