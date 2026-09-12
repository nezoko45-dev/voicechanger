import { PocketTTS } from "pocket-tts-js";

// Sentence-buffered Pocket TTS:
// - collect every generated chunk for one sentence
// - emit exactly one contiguous audio buffer when that sentence finishes
// - use a tiny edge fade to suppress clicks/beeps
// The live playback scheduler can then transition cleanly from one complete
// sentence to the next without exposing individual model chunk boundaries.
const originalGenerate = PocketTTS.prototype.generate;

function toFloat32(audio) {
  if (audio instanceof Float32Array) {
    const copy = new Float32Array(audio.length);
    copy.set(audio);
    return copy;
  }
  if (audio instanceof ArrayBuffer) return new Float32Array(audio.slice(0));
  if (ArrayBuffer.isView(audio)) {
    const bytes = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
    return new Float32Array(bytes);
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
  if (typeof options?.onChunk !== "function") {
    return originalGenerate.call(this, text, options);
  }

  const chunks = [];
  const sampleRate = Number(this.sampleRate) || 24000;

  const wrappedOptions = {
    ...options,
    onChunk: (audio) => {
      const samples = toFloat32(audio);
      if (samples?.length) chunks.push(sanitize(samples));
    }
  };

  const result = originalGenerate.call(this, text, wrappedOptions);

  const finish = (metrics) => {
    if (chunks.length) {
      const sentence = fadeEdges(joinChunks(chunks), sampleRate);
      options.onChunk(sentence);
    }
    return metrics;
  };

  if (result && typeof result.then === "function") return result.then(finish);
  return finish(result);
};
