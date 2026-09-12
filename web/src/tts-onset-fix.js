import { PocketTTS } from "pocket-tts-js";

// Keep Pocket TTS streaming so live conversion starts immediately. Only apply
// a tiny first-sample fade to prevent the sharp click/beep at playback onset.
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

function fadeIn(samples, sampleRate) {
  const count = Math.min(
    Math.max(1, Math.round((Number(sampleRate) || 24000) * 0.006)),
    Math.floor(samples.length / 2)
  );
  for (let i = 0; i < count; i++) samples[i] *= (i + 1) / count;
  return samples;
}

PocketTTS.prototype.generate = function (text, options = {}) {
  if (typeof options?.onChunk !== "function") {
    return originalGenerate.call(this, text, options);
  }

  let firstChunk = true;
  const wrappedOptions = {
    ...options,
    onChunk: (audio) => {
      const samples = toFloat32(audio);
      if (!samples?.length) return;
      sanitize(samples);
      if (firstChunk) {
        firstChunk = false;
        fadeIn(samples, this.sampleRate);
      }
      options.onChunk(samples);
    }
  };

  return originalGenerate.call(this, text, wrappedOptions);
};
