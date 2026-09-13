import { PocketTTS } from "pocket-tts-js";

// Smooth full-utterance Pocket TTS playback.
// Do not expose individual inference chunks to the audio scheduler. Collect the
// complete sentence, join it into one PCM buffer, then hand it off as one
// continuous audio stream. This removes chunk-boundary gaps and stuttering.
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
  const parts = [];
  let totalSamples = 0;

  const finish = () => {
    if (!totalSamples) return;

    const joined = new Float32Array(totalSamples);
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.length;
    }

    parts.length = 0;
    totalSamples = 0;

    // Tiny edge fades prevent clicks while preserving the complete sentence.
    const sampleRate = Number(this.sampleRate) || 24000;
    const fadeSamples = Math.min(
      Math.round(sampleRate * 0.003),
      Math.floor(joined.length / 2)
    );
    for (let i = 0; i < fadeSamples; i++) {
      const gain = (i + 1) / Math.max(1, fadeSamples);
      joined[i] *= gain;
      joined[joined.length - 1 - i] *= gain;
    }

    try {
      // One callback for the complete generated sentence.
      userOnChunk(joined);
    } catch {
      // Never let the audio callback crash the renderer.
    }
  };

  const wrappedOptions = {
    ...options,
    onChunk: (audio) => {
      try {
        const samples = toFloat32(audio);
        if (!samples?.length) return;
        parts.push(sanitize(samples));
        totalSamples += samples.length;
      } catch {
        // Ignore malformed inference chunks.
      }
    }
  };

  const result = originalGenerate.call(this, text, wrappedOptions);

  // Wait for Pocket TTS generation to finish, then send the sentence as one
  // contiguous PCM buffer. This deliberately trades a little startup latency
  // for smooth, uninterrupted full-sentence speech.
  if (result && typeof result.then === "function") {
    return result.then(
      (value) => {
        finish();
        return value;
      },
      (error) => {
        parts.length = 0;
        totalSamples = 0;
        throw error;
      }
    );
  }

  finish();
  return result;
};
