import { ChatterboxEngine, exposeEngine } from "https://esm.sh/voxshot@latest?bundle";

const engine = new ChatterboxEngine({
  stallTimeoutMs: 300000,
  onProgress: (event) => {
    try { self.postMessage({ type: "voxshot-progress", event }); } catch {}
  }
});

exposeEngine(engine, self);
