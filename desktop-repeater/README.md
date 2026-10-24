# Kokoro Voice Repeater desktop app

A separate Windows desktop app inside the voicechanger repository. It does not replace the existing browser extension.

## Build an installer (.exe)
1. Install Node.js 20 or newer on Windows.
2. Open a terminal in `desktop-repeater`.
3. Run `npm install`.
4. Run `npm run dist:win`.
5. Find the installer in `desktop-repeater/dist/`.

Or use the GitHub Actions workflow **Build Kokoro Desktop EXE** to build on a Windows runner and download the artifact.

## Run locally
Run `npm install`, then `npm run build`, then `npm start`. The app is packaged by Electron; Python is not used.

## AI behavior
- Whisper via Transformers.js / ONNX Runtime Web for local speech recognition.
- Kokoro via kokoro-js for local text-to-speech.
- WebGPU is requested first when enabled; model loading retries on WASM if WebGPU initialization fails.
- First launch downloads model files. Inference is local after caching; no paid API key is needed.
- The installer does not embed the large models, to keep the EXE size manageable.

This is an initial implementation and requires real hardware testing. WebGPU model support varies with Electron/Chromium, drivers, and model quantization. Use headphones to avoid the mic capturing TTS output.
