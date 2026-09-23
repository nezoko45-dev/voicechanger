# ONNX Web Voice Changer

Browser-only speech-to-speech RVC voice conversion.

**Microphone → ONNX Runtime Web / RVC → browser audio → Voicemeeter / VRChat**

## No Python
The active workflow uses Chrome/Edge only. No Python, .exe, Electron, server, STT, LLM, or TTS.

## First run
1. Open the GitHub Pages site in current Chrome or Edge.
2. Click **Download GuraTalkV2 voice**.
3. Click **Download ContentVec + RMVPE**.
4. Allow microphone access and choose the microphone.
5. Choose the browser output device.
6. Click **Start Voice Changer**.

Models are cached in IndexedDB after downloading.

The base models are quantized ONNX versions to reduce the browser download size. The first download is still large because RVC needs a target voice, a 768-dimensional content encoder, and a pitch estimator.

## Default voice
The default is **GuraTalkV2**, a public RVC v2 ONNX model hosted on Hugging Face. Its upstream talking-voice model repository is marked OpenRAIL. Use the model according to its published license/terms.

## Runtime
The app uses `rvc-web-runtime` 1.0.5. The runtime documents ContentVec + RMVPE WebGPU acceleration and an RVC synthesizer running through WASM because of a current WebGPU kernel limitation. It is an alpha-stage browser RVC runtime, so live conversational latency will depend heavily on your computer.

## VRChat
Route the browser output to your Voicemeeter path if Chrome exposes that output device, then select the corresponding virtual microphone in VRChat.

## Sources
- RVC-Web-Runtime: https://github.com/moyue23/rvc-web-runtime
- Default voice: https://huggingface.co/DogManTC/test-rvc-onnx
