# Pocket TTS Studio — Chatterbox ONNX WebGPU

Static GitHub Pages adaptation of [Chatterbox ONNX Web](https://github.com/strawberry-labs/chatterbox-onnx-web).

- Runs inference locally in the browser using ONNX Runtime Web with WebGPU where supported, and WASM fallback.
- Upload or record a reference voice; voice profiles and generation history are stored in IndexedDB.
- First load downloads model files from Hugging Face (approximately 350 MB FP32 plus tokenizer/runtime assets).
- This static build uses CDN ESM imports and explicitly points ONNX Runtime WASM assets at jsDelivr.
- GitHub Pages does not support custom COOP/COEP headers. The engine is configured for a single WASM thread; WebGPU support is detected at runtime.

Open `index.html` through the published GitHub Pages URL. Use Chrome/Edge with WebGPU enabled. If GPU inference is unavailable, the engine attempts its WASM provider.

Upstream project license and model licenses apply; see the upstream repository and Hugging Face model card.
