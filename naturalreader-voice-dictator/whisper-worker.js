import { pipeline, env } from "@huggingface/transformers";

// Audio is processed locally in this worker. The model is downloaded once and
// cached by the browser; microphone audio is never uploaded to a transcription API.
env.allowRemoteModels = true;
env.allowLocalModels = false;
env.useBrowserCache = true;

// Use the extension-packaged ONNX Runtime WebAssembly files for the fallback.
if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("assets/");
}

let transcriber = null;
let loadingPromise = null;
let actualDevice = "webgpu";

self.onmessage = async (event) => {
  const { type, audio, samplingRate, model } = event.data || {};
  try {
    if (type === "load") {
      if (transcriber) {
        self.postMessage({ type: "ready", device: actualDevice });
        return;
      }
      if (loadingPromise) {
        await loadingPromise;
        self.postMessage({ type: "ready", device: actualDevice });
        return;
      }

      loadingPromise = (async () => {
        self.postMessage({ type: "status", message: "Loading local Whisper model (first run may take a while)…" });
        try {
          transcriber = await pipeline(
            "automatic-speech-recognition",
            model || "onnx-community/whisper-tiny.en",
            { device: "webgpu", dtype: "q4" }
          );
          actualDevice = "webgpu";
        } catch (gpuError) {
          self.postMessage({ type: "status", message: "WebGPU unavailable; trying local WASM…" });
          transcriber = await pipeline(
            "automatic-speech-recognition",
            model || "onnx-community/whisper-tiny.en",
            { device: "wasm", dtype: "q8" }
          );
          actualDevice = "wasm";
        }
      })();

      try {
        await loadingPromise;
        self.postMessage({ type: "ready", device: actualDevice });
      } finally {
        loadingPromise = null;
      }
      return;
    }

    if (type === "transcribe") {
      if (!transcriber) throw new Error("Whisper model is not ready yet.");
      const result = await transcriber(audio, {
        sampling_rate: samplingRate || 16000,
        return_timestamps: false
      });
      self.postMessage({ type: "transcript", text: (result.text || "").trim() });
    }
  } catch (error) {
    loadingPromise = null;
    self.postMessage({ type: "error", message: error?.message || String(error) });
  }
};
