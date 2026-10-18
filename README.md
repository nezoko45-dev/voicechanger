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

## Windows desktop EXE (no separate Python install)

A Windows build is generated automatically by GitHub Actions whenever the launcher/backend/UI changes on `main`, and can also be started manually:

1. Open the repository's **Actions** tab: https://github.com/nezoko45-dev/voicechanger/actions/workflows/build-windows-exe.yml
2. Open the latest successful **Build Windows VoiceChanger EXE** run.
3. In **Artifacts**, download `VoiceChanger-Windows-x64` and extract `VoiceChanger.exe`.
4. Double-click `VoiceChanger.exe`. It starts the local backend and opens the web interface in Chrome (or your default browser if Chrome is not found).
5. Keep the console window open while using VoiceChanger; press Ctrl+C in that window to stop it.

The executable bundles the Python runtime and application dependencies. **Voice conversion model files are not bundled** and may download on first use, so internet access and extra disk space may be needed. The first packaged build has not been runtime-tested on this machine; if Windows SmartScreen warns about an unsigned executable, only run it if you trust the source and have built/downloaded it from this repository.

The desktop web UI is served at `http://127.0.0.1:8765/`; the backend binds to loopback only. If port 8765 is already occupied, close the other VoiceChanger/backend instance before launching the EXE.

## Load the extension
1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose the repository root folder (the folder containing `manifest.json`).
4. Keep the local backend running at `http://127.0.0.1:8765`.

## Use recorded conversion
1. Pick a reference audio file (WAV, MP3, M4A, OGG, or another browser-decodable audio format).
2. Press **Record source**, speak, then press **Stop recording**. The source WAV is created automatically in memory; there is no second file picker.
3. Press **Convert voice** and save the resulting WAV.

## Experimental live microphone conversion
1. Select a reference audio file and choose an engine.
2. Check the permission checkbox confirming you have permission to use the reference voice.
3. Press **Start live conversion** and allow microphone access. Converted audio plays through your default headphones/speakers. Press **Stop live** to end capture.
4. Use headphones to avoid acoustic feedback.

Live mode sends 4-second WAV chunks to the local backend over a WebSocket. This is a **chunk-based prototype, not true low-latency streaming**: conversion can take longer than real time, produce noticeable delay, skip chunks when processing falls behind, or sound discontinuous at chunk boundaries. Some engines may fail on short chunks. The existing recorded-file conversion remains available.

Audio is sent only to the local service at 127.0.0.1. The app captures microphone input only; it does not capture browser-tab or system audio. Use only reference recordings you have permission to use.

## Notes
- Browser support for decoding input reference formats varies. WAV is the most reliable.
- The extension is a UI client; voiceclonnx is a Python ONNX library and does not run directly inside Chrome.
- The service is intended for local development, not public exposure. Do not bind it to a public interface without adding authentication and security controls.
