// Chatterbox worker for the browser voice-clone app.
// Keep the language-model dtype explicit: VoxShot 0.3.0 can otherwise
// accidentally seed the 2 GB fp32 language model instead of q4.
import { ChatterboxEngine, exposeEngine } from "https://esm.sh/voxshot@0.3.0?bundle";

const engine = new ChatterboxEngine({
  stallTimeoutMs: 300000,
  dtype: {
    embed_tokens: "fp32",
    speech_encoder: "fp32",
    language_model: "q4",
    model: "q4",
    conditional_decoder: "fp32"
  },
  onProgress: (event) => {
    try { self.postMessage({ type: "voxshot-progress", event }); } catch {}
  }
});

exposeEngine(engine, self);
