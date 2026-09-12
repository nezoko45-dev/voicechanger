import { PocketTTS } from "pocket-tts-js";

// Buffer the complete Pocket TTS utterance before handing audio to the live
// playback scheduler. This removes chunk-arrival jitter and chunk-boundary
// stutter entirely; the scheduler receives one contiguous PCM buffer per
// utterance instead of many independently timed pieces.
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

PocketTTS.prototype.generate = function (text, options = {}) {
  if (typeof options?.onChunk !== "function") {
    return originalGenerate.call(this, text, options);
  }

  const chunks = [];

  const wrappedOptions = {
    ...options,
    onChunk: (audio) => {
      const samples = toFloat32(audio);
      if (samples?.length) chunks.push(sanitize(samples));
    }
  };

  const result = originalGenerate.call(this, text, wrappedOptions);

  // Pocket TTS resolves after its generated chunks have been delivered. Only
  // then emit the complete utterance as one audio buffer. This deliberately
  // trades a small amount of playback latency for stable, gap-free audio.
  if (result && typeof result.then === "function") {
    return result.then((metrics) => {
      if (chunks.length) options.onChunk(joinChunks(chunks));
      return metrics;
    });
  }

  if (chunks.length) options.onChunk(joinChunks(chunks));
  return result;
};
