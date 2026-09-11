// Chatterbox worker for the browser voice-clone app.
// Force the safer WebGPU q4 language model so Chrome does not try to allocate
// the full fp32 language model during startup.
import { ChatterboxEngine, exposeEngine } from 'https://esm.sh/gh/m96-chan/voxshot@main';

const engine = new ChatterboxEngine({
  requiresGpu: true,
  dtype: {
    language_model: 'q4',
    model: 'q4'
  },
  stallTimeoutMs: 300000
});

exposeEngine(engine, self);
