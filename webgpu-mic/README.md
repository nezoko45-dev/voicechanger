# VoiceClonNX Mic + WebGPU experiment

## Current branch status
- `index.html`: microphone selector, recording, reference WAV, local VoiceClonNX conversion, playback/download.
- Microphone audio is decoded by the browser and exported as PCM WAV before being sent to the local backend. This avoids sending the usual MediaRecorder WebM/Opus file to an API that expects WAV input.
- `model-probe.html`: experimental ONNX Runtime WebGPU session-compatibility probe for one local ONNX model at a time.

## Run
1. Start the existing VoiceClonNX local backend from the `girl-voice` extension project (it must listen on `127.0.0.1:8765`).
2. Serve this folder from localhost (microphone access requires a secure context such as localhost).
3. Open `index.html`, choose a microphone, record a short clip, select your reference WAV, and click Convert.
4. To investigate browser-side inference, open `model-probe.html` from localhost and select an ONNX model file from an engine's model set. The probe loads ONNX Runtime Web from a CDN, but the selected model bytes remain in the browser.

## What is and is not implemented
- The current conversion still runs through the local Python VoiceClonNX backend. WebGPU is **not yet** used for actual voice conversion.
- `model-probe.html` only tests whether ONNX Runtime Web can create a WebGPU session for a selected model and reports input/output names. It does not execute inference or convert audio.
- VoiceClonNX engines are multi-stage pipelines; a successful session for one ONNX file is not proof that the entire engine can run in the browser. Every model, tensor shape, preprocessing step, unsupported operator, and numerical result must be validated before porting an engine.
- The microphone page duplicates the selected reference WAV into the two reference slots required by the current local API. For best results, the backend should be updated to accept a single reference file directly or the UI should collect two separate reference clips.
- Browser microphone access works on localhost or another secure context. Model downloads for the local Python backend may still require internet access.

Use only voices you own or are authorized to use. Do not expose the local backend port to the public internet.
