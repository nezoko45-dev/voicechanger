# Fast Dictation + F5-TTS Browser Voice Clone Studio

A Chrome Manifest V3 extension with two tools:

- Hands-free dictation on [TTSLab.dev](https://ttslab.dev/) and [Fish Audio](https://fish.audio/).
- An F5-TTS browser-demo launcher for evaluating reference-audio voice cloning.

## Build the extension

Requirements: Node.js 20+ and a recent Chrome or Edge browser.

1. Download and extract this branch, or clone the repository and check out `feature/ttslab-fast-dictation`.
2. In the repository folder, run:
   ```sh
   npm install
   npm run build
   ```
3. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the generated `dist/` folder.

## Use dictation on TTSLab or Fish Audio

1. Open a TTSLab tool/model page with its **Stream** button, or Fish Audio's text-to-speech page with its **Generate Speech** button.
2. Click the extension icon and choose **Start listening**. Allow microphone access.
3. Speak naturally. After a brief pause, the extension attempts to activate the page's generation control.
4. Press **Stop listening** when finished.

## Try F5-TTS voice cloning

1. Click the extension icon, then **Open Voice Clone Studio**.
2. Click **Open F5-TTS browser demo**. It opens the F5-TTS demo in a separate tab.
3. Upload a clean 5–10 second reference clip, provide its exact transcript, enter the new text, and generate speech.

**Important:** this is an initial evaluation launcher, not yet a bundled F5-TTS inference engine inside the extension. The upstream browser implementation uses a custom ONNX encoder/transformer/decoder pipeline, tensor/audio operations, and worker integration; it is not compatible with a simple Transformers.js model-ID swap. The demo itself runs inference locally in your browser and downloads model assets on first use.

## Model and privacy notes

- F5-TTS is a zero-shot voice-cloning model; use only reference audio you own or have permission to use.
- The external demo is maintained at [nsarang/voice-cloning-f5-tts](https://github.com/nsarang/voice-cloning-f5-tts).
- First-time model downloads require an internet connection. Browser/device capability affects speed and compatibility.
- This branch's voice studio no longer presents Kokoro preset voices as voice cloning.
- All changes for this work are on `feature/ttslab-fast-dictation`; `main` is not modified.
