# Local VoiceChanger

Clean local browser voice changer using:

- Qwen3-TTS 0.6B Base for local voice cloning and TTS
- faster-whisper small for local speech-to-text
- Flask for the local browser server
- PyTorch for Qwen3-TTS
- soundfile for WAV output

## Windows

1. Install Python 3.12 or newer.
2. Extract the repository.
3. Double-click `LAUNCH_VOICECHANGER.bat`.
4. The launcher creates `.venv`, installs the exact required packages, starts the server, and opens the browser.
5. The first TTS/clone use downloads the Qwen model from Hugging Face. Later runs reuse the local model cache.

The app runs at `http://127.0.0.1:8765/` and does not require cloud API keys.
