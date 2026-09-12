import { PocketTTS } from "pocket-tts-js";

// pocket-tts-js sends cloneVoice() arguments to a Web Worker. Always hand it a
// fresh Float32Array and primitive options so browser structured cloning cannot
// receive an AudioBuffer-backed view or an accidental non-cloneable object.
const originalCloneVoice = PocketTTS.prototype.cloneVoice;
PocketTTS.prototype.cloneVoice = function (audio, options = {}) {
  let safeAudio;
  if (audio instanceof Float32Array) {
    safeAudio = new Float32Array(audio.length);
    safeAudio.set(audio);
  } else if (audio instanceof ArrayBuffer) {
    safeAudio = new Float32Array(audio.slice(0));
  } else if (ArrayBuffer.isView(audio)) {
    safeAudio = new Float32Array(audio.length);
    safeAudio.set(audio);
  } else {
    throw new TypeError("Pocket TTS clone input must be PCM Float32Array data.");
  }

  for (let i = 0; i < safeAudio.length; i++) {
    if (!Number.isFinite(safeAudio[i])) safeAudio[i] = 0;
  }

  const sampleRate = Number(options?.inputSampleRate);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new TypeError("Pocket TTS clone inputSampleRate is invalid.");
  }

  // Deliberately keep only the documented primitive option. The old app passed
  // a generated name through the worker request, which can trigger structured-
  // clone failures in some browser/package combinations.
  return originalCloneVoice.call(this, safeAudio, { inputSampleRate: sampleRate });
};
