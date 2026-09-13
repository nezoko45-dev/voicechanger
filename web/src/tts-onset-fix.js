import { PocketTTS } from "pocket-tts-js";

// Low-latency Pocket TTS bridge. Forward each valid chunk immediately instead
// of buffering the entire utterance, so cloned speech can begin as soon as the
// first audio is produced.
const originalGenerate = PocketTTS.prototype.generate;

function toFloat32(audio) {
  if (audio instanceof Float32Array) return audio;
  if (audio instanceof ArrayBuffer) {
    const usable = audio.byteLength - (audio.byteLength % 4);
    return usable > 0 ? new Float32Array(audio.slice(0, usable)) : null;
  }
  if (ArrayBuffer.isView(audio) && typeof audio.length === "number") {
    const copy = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i++) copy[i] = Number(audio[i]) || 0;
    return copy;
  }
  return null;
}

function sanitize(samples) {
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) samples[i] = 0;
    samples[i] = Math.max(-1, Math.min(1, samples[i]));
  }
  return samples;
}

PocketTTS.prototype.generate = function (text, options = {}) {
  if (typeof options?.onChunk !== "function") return originalGenerate.call(this, text, options);

  const userOnChunk = options.onChunk;
  let firstChunk = true;
  const wrappedOptions = {
    ...options,
    onChunk: (audio) => {
      try {
        const samples = toFloat32(audio);
        if (!samples?.length) return;
        const clean = sanitize(samples);
        // Tiny onset fade prevents a click without delaying the chunk.
        if (firstChunk) {
          const count = Math.min(Math.round((Number(this.sampleRate) || 24000) * 0.002), Math.floor(clean.length / 2));
          for (let i = 0; i < count; i++) clean[i] *= (i + 1) / Math.max(1, count);
          firstChunk = false;
        }
        userOnChunk(clean);
      } catch {
        // Ignore malformed individual chunks instead of crashing Electron.
      }
    }
  };

  return originalGenerate.call(this, text, wrappedOptions);
};
