import { pipeline, env } from "@huggingface/transformers";

// This worker is bundled into the extension. Audio is sent to this worker as
// Float32Array samples; only model files are fetched (and cached) on first use.
env.allowRemoteModels = true;
env.allowLocalModels = false;
env.useBrowserCache = true;\n// Load ONNX Runtime WebAssembly from files packaged with this extension.\nif (typeof chrome !== "undefined" && chrome.runtime?.getURL) {\n  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("assets/");\n}

let transcriber = null;
let loading = false;
self.onmessage = async (event) => {
  const { type, audio, samplingRate, model } = event.data || {};
  try {
    if (type === "load") {
      if (transcriber || loading) return;
      loading = true;
      self.postMessage({ type: "status", message: "Loading local Whisper model…" });
      try {
        transcriber = await pipeline("automatic-speech-recognition", model || "onnx-community/whisper-tiny.en", {
          device: "webgpu",
          dtype: "q4"
        });
        self.postMessage({ type: "ready", device: "webgpu" });
      } catch (gpuError) {
        self.postMessage({ type: "status", message: "WebGPU unavailable; trying local WASM…" });
        transcriber = await pipeline("automatic-speech-recognition", model || "onnx-community/whisper-tiny.en", {
          device: "wasm",
          dtype: "q8"
        });
        self.postMessage({ type: "ready", device: "wasm", fallback: true });
      } finally {
        loading = false;
      }
      return;
    }
    if (type === "transcribe") {
      if (!transcriber) throw new Error("Whisper model is not ready yet.");
      const result = await transcriber(audio, { sampling_rate: samplingRate || 16000, return_timestamps: false });
      self.postMessage({ type: "transcript", text: (result.text || "").trim() });
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || String(error) });
  }
};
