// Chatterbox worker for the browser voice-clone app.
// Let VoxShot choose WebGPU q4f16/q4 and fall back to WASM if WebGPU is unavailable.
import { ChatterboxEngine, exposeEngine } from 'https://esm.sh/gh/m96-chan/voxshot@main';

const engine = new ChatterboxEngine({
  requiresGpu: false,
  dtype: {
    language_model: 'q4',
    model: 'q4'
  },
  stallTimeoutMs: 300000
});

exposeEngine(engine, self);
