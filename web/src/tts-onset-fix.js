import { PocketTTS } from "pocket-tts-js";

// Low-latency, anti-stutter Pocket TTS bridge.
// Keep a tiny startup buffer so playback begins quickly but has enough audio
// queued to remain continuous when inference delivers chunks unevenly.
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
  const sampleRate = Number(this.sampleRate) || 24000;
  // ~120 ms is a small startup buffer: fast response without exposing
  // normal Pocket TTS inference jitter as audible gaps.
  const startupSamples = Math.round(sampleRate * 0.12);
  let firstChunk = true;
  let started = false;
  let buffered = [];
  let bufferedSamples = 0;

  const emit = (samples) => {
    if (!samples?.length) return;
    try {
      if (firstChunk) {
        const count = Math.min(Math.round(sampleRate * 0.002), Math.floor(samples.length / 2));
        for (let i = 0; i < count; i++) samples[i] *= (i + 1) / Math.max(1, count);
        firstChunk = false;
      }
      userOnChunk(samples);
    } catch {
      // Never let a bad audio callback crash the Electron renderer.
    }
  };

  const flushBuffered = () => {
    if (!bufferedSamples) return;
    const joined = new Float32Array(bufferedSamples);
    let offset = 0;
    for (const part of buffered) {
      joined.set(part, offset);
      offset += part.length;
    }
    buffered = [];
    bufferedSamples = 0;
    started = true;
    emit(joined);
  };

  const wrappedOptions = {
    ...options,
    onChunk: (audio) => {
      try {
        const samples = toFloat32(audio);
        if (!samples?.length) return;
        const clean = sanitize(samples);

        if (!started) {
          buffered.push(clean);
          bufferedSamples += clean.length;
          if (bufferedSamples >= startupSamples) flushBuffered();
          return;
        }

        // After startup, forward chunks immediately. main-fixed.js schedules
        // them on one continuous audio timeline to avoid chunk boundaries.
        emit(clean);
      } catch {
        // Ignore malformed individual chunks instead of crashing Electron.
      }
    }
  };

  const result = originalGenerate.call(this, text, wrappedOptions);

  // Flush very short utterances when generation completes so their audio is
  // never stranded waiting for the startup threshold.
  if (result && typeof result.then === "function") {
    return result.finally(() => {
      if (!started) flushBuffered();
    });
  }

  if (!started) flushBuffered();
  return result;
};
