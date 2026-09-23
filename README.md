# ONNX Voice Changer

This version replaces the old Deepgram/ElevenLabs experiments with browser-local ONNX Runtime Web.

## Pipeline

Microphone -> 16 kHz resample -> ContentVec -> RMVPE -> RVC ONNX -> Chrome audio -> Voicemeeter -> VRChat

The browser performs inference locally. No STT, TTS, Deepgram, ElevenLabs, GPT, or cloud voice-conversion API is used.

## Model files

The app needs:

1. Your RVC v2 voice model: .onnx (or .pth where supported by the runtime)
2. ContentVec/HuBERT: vec-768-layer-12.onnx
3. RMVPE: RMVPE.onnx

RVC-Web-Runtime currently supports RVC v2 models and uses ONNX Runtime Web. ContentVec and RMVPE can use WebGPU when available; the RVC synthesizer remains on WASM.

## Run locally

Chrome needs a secure/local web origin for microphone access. Run:

start.bat

Then open the address printed by the batch file.

## Important

This repository does not include large model weights. Select the model files in the browser.

The Buffer seconds control determines how much audio is collected before each conversion pass. It is intentionally adjustable because browser ONNX inference speed depends on the PC.
