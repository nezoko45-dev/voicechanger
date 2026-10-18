# VoiceChanger tools

This repository contains two separate unpacked Chrome extensions.

## VoiceChanger — VoiceClonNX

The `girl-voice` folder now provides an audio-to-audio voice conversion UI backed by the local [VoiceClonNX](https://github.com/TigreGotico/voiceclonnx) ONNX library.

1. Download this repository using **Code → Download ZIP**, then extract it.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `girl-voice` folder.
4. Click the extension icon and open the voice controls.
5. Download and run `start-voiceclonnx.bat` from the controls page. Keep the terminal open.
6. Select source speech and reference voice audio, choose an engine, and convert.

The first run installs Python dependencies; the first conversion downloads model files. See [girl-voice/README.md](girl-voice/README.md) for setup and limitations.

**Important:** VoiceClonNX converts existing audio files; it is not a real-time microphone changer and cannot create a system-wide virtual microphone by itself.

## Fish Audio Call Again

The helper extension is in the `extension` folder. Load that folder in `chrome://extensions` to use the Fish Audio **Call again** automation.

## Privacy

Voice conversion uses a local backend at `127.0.0.1`. Uploaded audio is processed locally and stored temporarily for conversion. VoiceClonNX downloads model files from Hugging Face as needed. The extension does not intentionally send your audio to a remote conversion service.
