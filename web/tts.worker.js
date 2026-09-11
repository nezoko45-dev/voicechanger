// Use VoxShot's current main branch build instead of the older npm release.
// The released package has a known Chatterbox dtype-plan problem that can make
// Transformers.js request the full fp32 language model (~2 GB) instead of the
// quantized WebGPU model. That can exhaust browser/GPU memory and crash Chrome.
import { ChatterboxEngine, exposeEngine } from 'https://esm.sh/gh/m96-chan/voxshot@main';

const engine = new ChatterboxEngine({
  requiresGpu: true,
  stallTimeoutMs: 120000
});

// Intentionally expose no progress events. The UI has no loading/progress bar.
exposeEngine(engine, self);
