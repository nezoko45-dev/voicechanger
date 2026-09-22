# Simple WebGPU Voice Cloner

This repo is now the simple browser-only version.

## What it does

headset mic → RVC voice conversion → Chrome output → Voicemeeter → VRChat

There is no Python, Electron, Deepgram STT, or Deepgram TTS.

## One-time voice model

1. Select your RVC v2 .onnx target voice model.
2. Click Build voice model once.
3. The target model is saved in the browser's IndexedDB.
4. ContentVec and RMVPE are downloaded automatically the first time and saved locally too.
5. Next time, the app can reuse the saved models without asking for the support files again.

The UI has only one model picker: your target RVC voice model.

## Requirements

- Chrome/Edge with WebGPU and hardware acceleration.
- An RVC v2 target voice model (.onnx; .pth may work through the runtime converter).
- A microphone.
- Voicemeeter if you want to send converted browser audio into VRChat.

RVC-Web-Runtime is browser-based and currently uses WebGPU for ContentVec/RMVPE while the main RVC synthesis stage runs through WASM. The runtime is alpha and processes audio in chunks.

## Voicemeeter

Set Chrome's Windows playback/output device to the Voicemeeter input you want. In Voicemeeter, route that input to the virtual microphone bus used by VRChat.

## Important distinction

This app stores and reuses a trained RVC target voice model. It does not train a new RVC model from a random WAV recording in the browser. RVC requires a target voice model plus its feature and pitch support models.