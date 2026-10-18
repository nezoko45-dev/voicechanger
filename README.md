# VoiceChanger — voiceclonnx Chrome extension

A minimal Chrome extension with one manually selected **reference voice** and an automatically created **source recording**. Audio conversion runs in a local Python service powered by [voiceclonnx](https://github.com/TigreGotico/voiceclonnx).

## Requirements
- Chrome or Chromium
- Python 3.10+
- A microphone
- Permission to use the reference speaker's voice

## Run the local conversion service
```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app:app --host 127.0.0.1 --port 8765
```
The first conversion may download ONNX model files. Choose an engine supported by voiceclonnx (default: `facodec`).

## Load the extension
1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose the `extension` folder.
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
