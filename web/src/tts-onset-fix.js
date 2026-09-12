import { PocketTTS } from "pocket-tts-js";

// Buffer the complete Pocket TTS utterance before handing audio to the live
// playback scheduler. This removes chunk-arrival jitter and chunk-boundary
// stutter. Tiny edge fades also remove the sharp DC/click-like onset that can
// be heard as a beep on some cloned voices and output devices.
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

function softenEdges(samples, sampleRate) {
  const fadeSamples = Math.min(Math.max(1, Math.round(sampleRate * 0.008)), Math.floor(samples.length / 2));
  for (let i = 0; i < fadeSamples; i++) {
    const gain = (i + 1) / fadeSamples;
    samples[i] *= gain;
    samples[samples.length - 1 - i] *= gain;
  }
  return samples;
}

function emitBuffered(chunks, onChunk, sampleRate) {
  if (!chunks.length) return;
  const joined = joinChunks(chunks);
  sanitize(joined);
  softenEdges(joined, sampleRate);
  onChunk(joined);
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

  if (result && typeof result.then === "function") {
    return result.then((metrics) => {
      emitBuffered(chunks, options.onChunk, sampleRate);
      return metrics;
    });
  }

  emitBuffered(chunks, options.onChunk, sampleRate);
  return result;
};
