import { pipeline, env } from "@huggingface/transformers";

// Audio is processed locally in this worker. The model is downloaded once and
// cached by the browser; microphone audio is never uploaded to a transcription API.
env.allowRemoteModels = true;
env.allowLocalModels = false;
env.useBrowserCache = true;

// The worker may be launched from a Blob URL, where chrome.runtime is unavailable.
// The content script passes the packaged WASM directory in the load message.

let transcriber = null;
let loadingPromise = null;
let actualDevice = "webgpu";

self.onmessage = async (event) => {
  const { type, audio, samplingRate, model, wasmPaths } = event.data || {};
  try {
    if (type === "load") {
      if (wasmPaths) env.backends.onnx.wasm.wasmPaths = wasmPaths;
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
        self.postMessage({ type: "status", message: "Loading local Whisper on CPU (no experimental WebGPU setting needed)…" });
        // Prefer the stable WASM CPU backend so users do not need unsafe/experimental WebGPU.
        transcriber = await pipeline(
          "automatic-speech-recognition",
          model || "onnx-community/whisper-tiny.en",
          { device: "wasm", dtype: "q8" }
        );
        actualDevice = "wasm";
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
