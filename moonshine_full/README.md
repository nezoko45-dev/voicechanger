# Moonshine Full Voice Changer

This is the standalone browser version of the voice pipeline. It does not use TTS Voice Wizard or Whisper.

```text
Microphone
   ↓
Moonshine Tiny Streaming STT
   ↓
finished speech phrase
   ↓
Moonshine ZipVoice voice clone
   ↓
Chrome audio output / selected speaker
   ↓
VRChat
```

## Features

- Moonshine Tiny Streaming STT for low-latency live transcription.
- Moonshine TextToSpeech with ZipVoice zero-shot voice cloning.
- Clone from a WAV file or record a short reference from the selected microphone.
- Microphone selection.
- Output-device selection in Chrome when supported.
- Automatic TTS after each finished speech phrase.
- Option to drop old TTS instead of building a long queue.
- Manual TTS test button.
- No Python.
- No TTS Voice Wizard.
- No Whisper.
- No hosted STT/TTS inference.

Moonshine's official WebAssembly package is loaded from jsDelivr. Model assets are downloaded on first use and cached by the browser, so later launches can reuse them locally. The default WASM build needs cross-origin isolation, which `serve.mjs` supplies with COOP/COEP headers.

## Run

1. Install Node.js if it is not already installed.
2. Double-click `start_moonshine_full.bat`.
3. Chrome opens `http://127.0.0.1:8788/`.
4. Allow microphone access.
5. Select your microphone and output.
6. Choose a WAV reference and press **LOAD / CLONE VOICE**, or press **Record voice clone**.
7. Press **START**.
8. Speak normally. A finalized Moonshine STT phrase is sent directly to the cloned TTS.

## VRChat routing

For a virtual microphone, select the virtual/Voicemeeter output as the TTS output. Then select the corresponding virtual output as the microphone in VRChat.

For lowest latency, leaving **Default output** selected uses Moonshine's worker-backed `say()` path. Selecting a specific browser output uses `synthesize()` and Chrome's output routing API.

## Important

The first model load can take a while because Moonshine downloads its STT and TTS assets. The assets are cached by the browser afterward. The app keeps the models loaded instead of downloading/loading them for every phrase.

The current implementation uses the official `@moonshine-ai/moonshine-wasm` 0.1.5 API, including `MicTranscriber`, `ModelArch.TinyStreaming`, `TextToSpeech.cloning()`, `startCloning()`, `cloneFrom()`, `say()`, and `synthesize()`.
