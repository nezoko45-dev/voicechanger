import { PocketTTS } from "pocket-tts-js";

// Keep cloneVoice() worker messages strictly structured-cloneable.
// After cloning, run a tiny throwaway synthesis so ONNX sessions are warmed
// before the first real conversion phrase. This removes the one-time EXE
// inference/session startup hit from the first spoken reply.
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

  return originalCloneVoice.call(this, safeAudio, { inputSampleRate: sampleRate }).then(async (voice) => {
    try {
      await this.generate("Hi.", {
        voice,
        onChunk: () => {}
      });
    } catch {
      // Prewarm is an optimization only. Never make voice cloning fail because
      // the throwaway warmup could not run.
    }
    return voice;
  });
};
