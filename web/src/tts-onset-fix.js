import { PocketTTS } from "pocket-tts-js";

// Pocket TTS can produce a tiny duplicated consonant/onset on the very first
// streaming chunk (e.g. "th-tha..."). Trim only the leading artifact from
// the first generated chunk; later chunks are left untouched so normal speech
// timing and consonants are preserved.
const originalGenerate = PocketTTS.prototype.generate;
PocketTTS.prototype.generate = function (text, options = {}) {
  if (typeof options?.onChunk !== "function") {
    return originalGenerate.call(this, text, options);
  }

  let firstChunk = true;
  const sampleRate = Number(this.sampleRate) || 24000;
  const trimSamples = Math.min(Math.round(sampleRate * 0.045), 1800);
  const wrappedOptions = {
    ...options,
    onChunk: (audio) => {
      if (!firstChunk) {
        options.onChunk(audio);
        return;
      }
      firstChunk = false;

      if (audio instanceof Float32Array && audio.length > trimSamples + 64) {
        options.onChunk(audio.slice(trimSamples));
      } else if (audio instanceof Float32Array) {
        options.onChunk(audio);
      } else if (audio instanceof ArrayBuffer) {
        const view = new Float32Array(audio);
        options.onChunk(view.length > trimSamples + 64 ? view.slice(trimSamples) : view);
      } else if (ArrayBuffer.isView(audio)) {
        const view = new Float32Array(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength));
        options.onChunk(view.length > trimSamples + 64 ? view.slice(trimSamples) : view);
      } else {
        options.onChunk(audio);
      }
    }
  };

  return originalGenerate.call(this, text, wrappedOptions);
};
