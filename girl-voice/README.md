# VoiceChanger — VoiceClonNX

A Manifest V3 Chrome extension for local audio-to-audio voice conversion using the [VoiceClonNX](https://github.com/TigreGotico/voiceclonnx) ONNX library. It converts source speech to a reference speaker's voice; it is not a live microphone pitch shifter.

## Default engine: OpenVoice V2

The extension defaults to VoiceClonNX's `openvoice` engine, which packages OpenVoice V2 tone-color conversion as ONNX models. It converts source speech toward the voice in your reference recordings. The model files download on first conversion; the OpenVoice V2 ONNX artifacts are around 174 MB before caching. You can still choose another engine from the selector.

## Start on Windows

1. Open `chrome://extensions`, enable **Developer mode**, and load this `girl-voice` folder as an unpacked extension.
2. Click the extension icon, then **Open voice controls**.
3. In the controls page, click **Download Windows .bat launcher**.
4. Run `start-voiceclonnx.bat`. The launcher creates a local Python virtual environment and installs the backend requirements. Keep its terminal window open.
5. Return to the controls page. When the backend shows as connected, select one or more source WAV files.
6. Select **exactly two reference WAV files** recorded from the same target speaker. The local backend combines the two clips into a single mono WAV, adding a short silent gap and resampling the second clip to match the first clip's sample rate if needed.
7. OpenVoice V2 is selected by default; choose another VoiceClonNX engine if desired, then click **Combine references and convert WAV files**. Each source file is converted sequentially using the combined two-clip reference. Use each result's **Download WAV** link to save the converted files.

The first startup may take a few minutes while packages install. The first conversion downloads the selected model files from Hugging Face and requires an internet connection. Later conversions can reuse cached models. Use Python 3.10+ on Windows.

## Local backend

The extension calls `http://127.0.0.1:8765`. The local FastAPI service is defined in `server.py`. It accepts a source WAV plus two reference WAVs, combines the reference clips locally using SoundFile and NumPy, and returns a converted WAV.

## Limitations

- This workflow converts recorded audio files; it is **not real-time** and does not create a system-wide virtual microphone for Discord or other desktop apps.
- Conversion time and quality vary by engine and hardware.
- Source and reference files are processed by the local backend. Model downloads are fetched from Hugging Face.
- Use voices you own or have permission to use. Check model and voice-weight licenses for your intended use.
- Do not expose the local backend port to the public internet.

## Privacy

Uploaded audio is written to temporary files on your computer for conversion and removed after the response is sent. The extension does not intentionally upload audio to a remote service.
