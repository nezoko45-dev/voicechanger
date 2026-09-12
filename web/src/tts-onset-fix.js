import { PocketTTS } from "pocket-tts-js";

// Smooth Pocket TTS streaming boundaries instead of deleting a fixed amount of
// audio from the first chunk. The old 45 ms workaround could remove real
// consonants and did not address uneven chunk boundaries.
const originalGenerate = PocketTTS.prototype.generate;

function toFloat32(audio) {
  if (audio instanceof Float32Array) return new Float32Array(audio);
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

// Remove only genuine digital silence at the very beginning. This is adaptive
// and capped tightly so normal speech attacks (including "th", "s", and "f")
// are never chopped off just because they are quiet.
function trimLeadingSilence(samples, sampleRate) {
  const maxScan = Math.min(samples.length, Math.round(sampleRate * 0.012));
  const threshold = 0.004;
  let i = 0;
  while (i < maxScan && Math.abs(samples[i]) < threshold) i++;
  if (i > 0 && i < maxScan) return samples.slice(i);
  return samples;
}

function crossfadePair(previous, current, sampleRate) {
  const overlap = Math.min(
    Math.round(sampleRate * 0.012),
    Math.floor(previous.length / 3),
    Math.floor(current.length / 3)
  );

  if (overlap < 16) {
    return { audio: null, overlap: 0 };
  }

  const out = new Float32Array(previous.length + current.length - overlap);
  out.set(previous.subarray(0, previous.length - overlap), 0);

  const start = previous.length - overlap;
  for (let i = 0; i < overlap; i++) {
    const t = i / Math.max(1, overlap - 1);
    const fadeOut = Math.cos(t * Math.PI * 0.5);
    const fadeIn = Math.sin(t * Math.PI * 0.5);
    out[start + i] = previous[previous.length - overlap + i] * fadeOut + current[i] * fadeIn;
  }

  out.set(current.subarray(overlap), start + overlap);
  return { audio: out, overlap };
}

PocketTTS.prototype.generate = function (text, options = {}) {
  if (typeof options?.onChunk !== "function") {
    return originalGenerate.call(this, text, options);
  }

  const sampleRate = Number(this.sampleRate) || 24000;
  let pending = null;
  let firstChunk = true;

  const emit = (audio) => {
    if (audio?.length) options.onChunk(audio);
  };

  const pushChunk = (audio) => {
    let samples = toFloat32(audio);
    if (!samples?.length) return;
    samples = sanitize(samples);

    if (firstChunk) {
      firstChunk = false;
      samples = trimLeadingSilence(samples, sampleRate);
    }
    if (!samples.length) return;

    if (!pending) {
      pending = samples;
      return;
    }

    const { audio: blended, overlap } = crossfadePair(pending, samples, sampleRate);

    if (!blended || overlap < 16) {
      // Tiny chunks are not worth crossfading. Keep the stream lossless rather
      // than manufacturing an artificial gap or dropping speech.
      emit(pending);
      pending = samples;
      return;
    }

    // Emit exactly through the crossfade. The remainder of the current chunk
    // has already been included after the overlap in `blended`, so retain only
    // that un-emitted remainder for the next boundary.
    emit(blended.slice(0, pending.length));
    pending = samples.slice(overlap);
  };

  const wrappedOptions = {
    ...options,
    onChunk: pushChunk
  };

  return Promise.resolve(originalGenerate.call(this, text, wrappedOptions)).then((metrics) => {
    if (pending?.length) emit(pending);
    pending = null;
    return metrics;
  }).catch((error) => {
    pending = null;
    throw error;
  });
};
