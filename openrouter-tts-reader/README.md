# Chatterbox Turbo Reader

This reader uses Chatterbox-Turbo ONNX locally in the browser. It does not use Fish Audio, an API key, a hosted voice service, or preset voices.

## Use

1. Open the GitHub Pages reader.
2. Click **Load Chatterbox model** and wait for the first model download to finish.
3. Select your own WAV recording and click **Use this WAV voice**.
4. Type text or use microphone dictation, then click **Generate & read aloud**.

The WAV is converted to mono 24 kHz audio and used as the reference for each generation. The browser caches model files with the Cache API. The reference audio is held in the active page session; reselect the WAV after refreshing.

## Requirements

- Current Chrome or Edge recommended.
- WebGPU is recommended for speed; the model attempts WASM when WebGPU is unavailable.
- First model download is approximately 350 MB for FP32, plus tokenizer assets.
- Keep the tab open while the model loads and generates audio.

## Architecture

- `index.html`: existing dictation and reader UI, updated to use local inference.
- `chatterbox-worker.js`: keeps model inference off the UI thread.
- `chatterbox-turbo-engine.js`: browser ONNX implementation adapted from the upstream project.

The old `fish-audio-local-backend` executable is not used by this reader. No local backend process is required.

## Upstream project

This integration adapts the Chatterbox-Turbo ONNX browser implementation:
https://github.com/strawberry-labs/chatterbox-onnx-web

That upstream project is MIT licensed. Model files are downloaded from:
https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX

Use only reference audio you own or have permission to clone.
