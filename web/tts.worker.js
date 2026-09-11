import { ChatterboxEngine, exposeEngine } from 'https://esm.sh/voxshot';

// Keep the heavy ONNX model entirely inside the worker. No progress events are
// forwarded to the UI: loading is intentionally silent.
const engine = new ChatterboxEngine({
  requiresGpu: true,
  stallTimeoutMs: 120000
});

exposeEngine(engine, self);
