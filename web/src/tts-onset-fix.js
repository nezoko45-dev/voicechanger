import { PocketTTS, chunksToWavBlob } from "pocket-tts-js";

// Smooth full-utterance Pocket TTS playback.
// Conversion speech is routed through one HTMLAudioElement so the selected
// Windows output device is actually honored. This avoids AudioContext.destination,
// which always follows the default system output in the current Electron build.
const originalGenerate = PocketTTS.prototype.generate;
let selectedOutputAudio = null;
let selectedOutputUrl = null;

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

function selectedDevice() {
  return document.getElementById("outputDevice")?.value || "default";
}

async function playOnSelectedOutput(samples, sampleRate) {
  if (!samples?.length) return;

  if (selectedOutputAudio) {
    try { selectedOutputAudio.pause(); } catch {}
    selectedOutputAudio.removeAttribute("src");
    try { selectedOutputAudio.load(); } catch {}
  }
  if (selectedOutputUrl) {
    URL.revokeObjectURL(selectedOutputUrl);
    selectedOutputUrl = null;
  }

  const blob = chunksToWavBlob([samples], sampleRate);
  selectedOutputUrl = URL.createObjectURL(blob);
  const audio = new Audio();
  selectedOutputAudio = audio;
  audio.preload = "auto";

  const wanted = selectedDevice();
  if (typeof audio.setSinkId === "function") {
    try {
      await audio.setSinkId(wanted);
      const select = document.getElementById("outputDevice");
      const label = select?.selectedOptions?.[0]?.text || wanted;
      const logBox = document.getElementById("log");
      if (logBox) logBox.textContent = `${new Date().toLocaleTimeString()} — Conversion output routed to: ${label}\n${logBox.textContent}`;
    } catch (e) {
      const logBox = document.getElementById("log");
      if (logBox) logBox.textContent = `${new Date().toLocaleTimeString()} — OUTPUT DEVICE FAILED: ${e.message}\n${logBox.textContent}`;
    }
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    const done = (error) => {
      if (settled) return;
      settled = true;
      audio.onended = null;
      audio.onerror = null;
      if (selectedOutputAudio === audio) selectedOutputAudio = null;
      if (selectedOutputUrl) {
        URL.revokeObjectURL(selectedOutputUrl);
        selectedOutputUrl = null;
      }
      if (error) reject(error); else resolve();
    };
    audio.onended = () => done();
    audio.onerror = () => done(new Error("Selected output audio playback failed."));
    audio.src = selectedOutputUrl;
    audio.play().catch(done);
  });
}

PocketTTS.prototype.generate = function (text, options = {}) {
  if (typeof options?.onChunk !== "function") return originalGenerate.call(this, text, options);

  const userOnChunk = options.onChunk;
  const routeToSelectedOutput = options.outputToSelectedDevice === true;
  const parts = [];
  let totalSamples = 0;

  const finish = async () => {
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

    if (routeToSelectedOutput) {
      // Play the complete sentence through HTMLAudioElement.setSinkId so the
      // user's selected VoiceMeeter/Magic Mic/Windows output is respected.
      await playOnSelectedOutput(joined, sampleRate);
      return;
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

  if (result && typeof result.then === "function") {
    return result.then(
      async (value) => {
        await finish();
        return value;
      },
      (error) => {
        parts.length = 0;
        totalSamples = 0;
        throw error;
      }
    );
  }

  return finish().then(() => result);
};
