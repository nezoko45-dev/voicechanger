import { ChatterboxEngine, exposeEngine } from 'https://esm.sh/voxshot';

let server;

const engine = new ChatterboxEngine({
  stallTimeoutMs: 300000,
  onProgress: event => server?.emitProgress(event)
});

server = exposeEngine(engine, self);
