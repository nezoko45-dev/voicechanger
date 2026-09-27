# Local WAV Voice Agent

This repo contains a local HTML/JavaScript voice agent using **Recording (10).wav** as the target/reference voice.

## 100%% Offline Operation

The local voice-agent setup is designed to run without Internet access.

**setup_local.bat never downloads anything.** It does not use:

- winget
- curl
- npm install
- npm registry
- GitHub downloads
- Deepgram
- any cloud speech API

Instead, the package must already contain the runtime dependency folder, STT model, PocketTTS model, and reference WAV.

### Required files

`Recording (10).wav`

`node_modules\sherpa-onnx-node\`

`node_modules\ws\`

`models\sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\`

`models\sherpa-onnx-pocket-tts-int8-2026-01-26\`

If any of these are missing, setup stops instead of trying to download them.

## First-time packaging requirement

Because this repository cannot download missing dependencies in offline mode, the **offline bundle itself must contain** the Node modules and model files before it is moved to an offline PC.

Node.js itself is also expected to be installed already. `setup_local.bat` will not install Node.js.

## Run

1. Make sure Node.js is already installed.
2. Make sure the bundled `node_modules` and `models` folders are present.
3. Run `setup_local.bat`.
4. Run `start_local.bat`.
5. Chrome opens at `http://127.0.0.1:8787/`.
6. Choose your microphone and output.
7. Press **START** and speak.

The browser communicates only with the local server at `127.0.0.1`.

## Architecture

Microphone → Chrome AudioWorklet → local sherpa-onnx streaming STT → same-text repeat agent → local PocketTTS voice cloning → Chrome output / Voicemeeter → VRChat

This is **speech → text → cloned speech**, not waveform-preserving live voice conversion. PocketTTS uses the WAV as a reference voice.

## VRChat

Select the desired Voicemeeter output in the browser output selector when Chrome exposes it. In VRChat, select the corresponding Voicemeeter virtual microphone/input.

## Important

The GitHub repository itself can still be accessed over the Internet, but the **offline setup script and the running local agent do not require an Internet connection** once the complete offline bundle is present.
