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

// Hold one generated chunk so the next chunk can overlap its boundary. A
// short equal-power crossfade removes clicks, tiny gaps, and repeated-sounding
// attacks caused by starting each AudioBufferSourceNode independently.
function crossfadePair(previous, current, sampleRate) {
  const overlap = Math.min(
    Math.round(sampleRate * 0.012),
    Math.floor(previous.length / 3),
    Math.floor(current.length / 3)
  );

  if (overlap < 16) {
    const out = new Float32Array(previous.length + current.length);
    out.set(previous, 0);
    out.set(current, previous.length);
    return out;
  }

  const out = new Float32Array(previous.length + current.length - overlap);
  out.set(previous.subarray(0, previous.length - overlap), 0);

  const start = previous.length - overlap;
  for (let i = 0; i < overlap; i++) {
    const t = i / Math.max(1, overlap - 1);
    // Equal-power-ish curve; avoids a volume dip at the join.
    const fadeOut = Math.cos(t * Math.PI * 0.5);
    const fadeIn = Math.sin(t * Math.PI * 0.5);
    out[start + i] = previous[previous.length - overlap + i] * fadeOut + current[i] * fadeIn;
  }

  out.set(current.subarray(overlap), start + overlap);
  return out;
}

PocketTTS.prototype.generate = function (text, options = {}) {
  if (typeof options?.onChunk !== "function") {
    return originalGenerate.call(this, text, options);
  }

  const sampleRate = Number(this.sampleRate) || 24000;
  let pending = null;
  let firstChunk = true;
  let generationError = null;
  let ended = false;

  const emit = (audio) => {
    try {
      options.onChunk(audio);
    } catch (error) {
      generationError = error;
      throw error;
    }
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

    const blended = crossfadePair(pending, samples, sampleRate);
    // The blended buffer contains the previous chunk and the new chunk with a
    // real overlap. Holding the new chunk for the next callback keeps the
    // playback pipeline continuous without needing changes to main-fixed.js.
    const overlap = Math.min(
      Math.round(sampleRate * 0.012),
      Math.floor(pending.length / 3),
      Math.floor(samples.length / 3)
    );

    if (overlap >= 16) {
      // Emit everything except the held tail that must be joined to the next
      // chunk. This keeps latency bounded while preserving a true overlap.
      const hold = samples;
      const emitLength = Math.max(1, blended.length - hold.length);
      emit(blended.slice(0, emitLength));
      pending = hold;
    } else {
      emit(blended);
      pending = null;
    }
  };

  const wrappedOptions = {
    ...options,
    onChunk: pushChunk
  };

  const result = originalGenerate.call(this, text, wrappedOptions);

  return Promise.resolve(result).then((metrics) => {
    ended = true;
    if (generationError) throw generationError;
    if (pending?.length) {
      emit(pending);
      pending = null;
    }
    return metrics;
  }).catch((error) => {
    ended = true;
    pending = null;
    throw error;
  });
};
