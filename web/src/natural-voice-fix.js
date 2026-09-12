import { PocketTTS } from "pocket-tts-js";

// Naturalness pass for cloned speech:
// 1) Clean the reference clip before voice cloning so Pocket TTS does not learn
//    room noise, long silence, or an overly quiet recording.
// 2) Give live STT text clearer conversational punctuation when Deepgram sends
//    a final transcript without enough sentence cues.
// 3) Keep the actual voice identity untouched; this is a prosody/input-quality
//    improvement rather than a pitch-changing effect.

const originalCloneVoice = PocketTTS.prototype.cloneVoice;
const originalGenerate = PocketTTS.prototype.generate;

function trimSilence(samples, threshold = 0.012, pad = 0.08, sampleRate = 24000) {
  let first = 0;
  let last = samples.length - 1;
  const peak = Math.max(0.04, ...samples.map((v) => Math.abs(v)));
  const gate = Math.min(0.035, Math.max(threshold, peak * 0.025));

  while (first < samples.length && Math.abs(samples[first]) < gate) first++;
  while (last > first && Math.abs(samples[last]) < gate) last--;
  if (first >= last) return samples;

  const padding = Math.min(Math.round(sampleRate * pad), Math.round(samples.length * 0.12));
  first = Math.max(0, first - padding);
  last = Math.min(samples.length - 1, last + padding);
  return samples.slice(first, last + 1);
}

function normalizeReference(samples) {
  let peak = 0;
  let sum = 0;
  for (const sample of samples) {
    const v = Number.isFinite(sample) ? sample : 0;
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  if (!peak) return samples;

  // Keep headroom. Aggressive normalization can make room noise part of the
  // cloned voice, so cap the gain instead of forcing every recording to 0 dBFS.
  const targetPeak = 0.78;
  const gain = Math.min(1.8, targetPeak / peak);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Number.isFinite(samples[i]) ? samples[i] * gain : 0;
    out[i] = Math.max(-0.98, Math.min(0.98, v));
  }
  return out;
}

PocketTTS.prototype.cloneVoice = function (audio, options = {}) {
  const inputRate = Number(options?.inputSampleRate) || 24000;
  const input = audio instanceof Float32Array ? new Float32Array(audio) : new Float32Array(audio);
  const cleaned = trimSilence(input, 0.012, 0.08, inputRate);
  const normalized = normalizeReference(cleaned);
  return originalCloneVoice.call(this, normalized, {
    inputSampleRate: inputRate,
    name: options?.name,
  });
};

function naturalizeText(text) {
  let value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return value;

  // Restore a few high-value conversational pauses without rewriting the words.
  value = value
    .replace(/\s*([,!?;:])\s*/g, "$1 ")
    .replace(/\.{2,}/g, "…")
    .replace(/\b(uh|um|well|okay|ok|so|actually|honestly|yeah|yes|no)\s+(?=[A-Z])/gi, "$1, ");

  // STT occasionally returns a sentence with no terminal punctuation. A real
  // sentence boundary gives Pocket TTS a much more natural falling cadence.
  if (!/[.!?…]$/.test(value)) value += ".";

  // Give questions an actual rising question boundary when the wording clearly
  // looks interrogative and Deepgram omitted the question mark.
  if (/^(who|what|when|where|why|how|can|could|would|will|do|does|did|is|are|was|were|have|has|should|shall)\b/i.test(value)) {
    value = value.replace(/\.$/, "?");
  }

  return value.trim();
}

PocketTTS.prototype.generate = function (text, options = {}) {
  return originalGenerate.call(this, naturalizeText(text), options);
};
