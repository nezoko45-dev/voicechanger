# Local WAV Voice Agent

The repo now includes a simple local HTML/JavaScript voice agent using the existing **Recording (10).wav** as its target/reference voice.

## Architecture

Microphone → Chrome AudioWorklet → local sherpa-onnx streaming STT → local repeat agent → PocketTTS voice cloning → Chrome output / Voicemeeter → VRChat

No Deepgram or other cloud speech API is used by this path.

## Setup

1. Install Node.js 20+.
2. Run **setup_local.bat**.
3. The setup downloads the local ASR and PocketTTS model packages into `models/`.
4. Run **start_local.bat**.
5. Chrome opens at `http://127.0.0.1:8787/`.
6. Choose your microphone and output.
7. Press **START** and speak.

Reference WAV: `Recording (10).wav`

Keep that file in the repo root. The local Node server reads it directly and gives it to PocketTTS as the reference voice.

## VRChat

Select your desired Voicemeeter output in the browser output selector when Chrome exposes it. In VRChat, select the corresponding Voicemeeter virtual microphone/input.

## What this first version does

It intentionally uses a simple repeat-me agent:

speech → local STT → same text → local cloned TTS

This is **voice cloning TTS**, not waveform-preserving live voice conversion. PocketTTS is specifically designed for zero-shot cloning from a short reference audio clip and does not require a reference transcript.

The model files are downloaded locally by `setup_local.bat` and are not committed to GitHub.

The older Rust/Seed-VC files remain in the repo, but **start_local.bat does not use them**.
