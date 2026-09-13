import { PocketTTS } from "pocket-tts-js";

// Sentence-buffered Pocket TTS. Keep every conversion strictly Float32 so
// malformed/non-aligned typed-array payloads cannot throw RangeError in Electron.
const originalGenerate = PocketTTS.prototype.generate;

function toFloat32(audio) {
  if (audio instanceof Float32Array) {
    const copy = new Float32Array(audio.length);
    copy.set(audio);
    return copy;
  }
  if (audio instanceof ArrayBuffer) {
    const usable = audio.byteLength - (audio.byteLength % 4);
    if (usable <= 0) return null;
    return new Float32Array(audio.slice(0, usable));
  }
  if (ArrayBuffer.isView(audio)) {
    if (typeof audio.length === "number") {
      const copy = new Float32Array(audio.length);
      for (let i = 0; i < audio.length; i++) copy[i] = Number(audio[i]) || 0;
      return copy;
    }
    return null;
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

function joinChunks(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

function fadeEdges(samples, sampleRate) {
  const count = Math.min(
    Math.max(1, Math.round((Number(sampleRate) || 24000) * 0.004)),
    Math.floor(samples.length / 2)
  );
  for (let i = 0; i < count; i++) {
    const gain = (i + 1) / count;
    samples[i] *= gain;
    samples[samples.length - 1 - i] *= gain;
  }
  return samples;
}

PocketTTS.prototype.generate = function (text, options = {}) {
  if (typeof options?.onChunk !== "function") return originalGenerate.call(this, text, options);

  const chunks = [];
  const sampleRate = Number(this.sampleRate) || 24000;
  const wrappedOptions = {
    ...options,
    onChunk: (audio) => {
      try {
        const samples = toFloat32(audio);
        if (samples?.length) chunks.push(sanitize(samples));
      } catch {
        // Ignore a malformed individual chunk rather than crashing the renderer.
      }
    }
  };

  let result;
  try {
    result = originalGenerate.call(this, text, wrappedOptions);
  } catch (error) {
    throw error;
  }

  const finish = (metrics) => {
    if (chunks.length) options.onChunk(fadeEdges(joinChunks(chunks), sampleRate));
    return metrics;
  };
  return result && typeof result.then === "function" ? result.then(finish) : finish(result);
};
