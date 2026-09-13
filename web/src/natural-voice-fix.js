import { PocketTTS } from "pocket-tts-js";

// Naturalness pass for cloned speech. Keep this patch stack-safe: never spread
// an entire audio buffer into Math.max(), because a multi-second recording can
// contain hundreds of thousands of samples and that itself causes
// "Maximum call stack size exceeded".

const originalCloneVoice = PocketTTS.prototype.cloneVoice;
const originalGenerate = PocketTTS.prototype.generate;

function trimSilence(samples, threshold = 0.012, pad = 0.08, sampleRate = 24000) {
  let first = 0;
  let last = samples.length - 1;
  let peak = 0;

  // IMPORTANT: use a loop, not Math.max(...samples), so large recordings are safe.
  for (let i = 0; i < samples.length; i++) {
    const v = Number.isFinite(samples[i]) ? Math.abs(samples[i]) : 0;
    if (v > peak) peak = v;
  }

  peak = Math.max(0.04, peak);
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
  for (let i = 0; i < samples.length; i++) {
    const v = Number.isFinite(samples[i]) ? Math.abs(samples[i]) : 0;
    if (v > peak) peak = v;
  }
  if (!peak) return samples;

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

  // Pass only the documented primitive option to the underlying implementation.
  return originalCloneVoice.call(this, normalized, {
    inputSampleRate: inputRate,
    name: typeof options?.name === "string" ? options.name : "cloned-voice"
  });
};

function naturalizeText(text) {
  let value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return value;

  value = value
    .replace(/\s*([,!?;:])\s*/g, "$1 ")
    .replace(/\.{2,}/g, "…")
    .replace(/\b(uh|um|well|okay|ok|so|actually|honestly|yeah|yes|no)\s+(?=[A-Z])/gi, "$1, ");

  if (!/[.!?…]$/.test(value)) value += ".";

  if (/^(who|what|when|where|why|how|can|could|would|will|do|does|did|is|are|was|were|have|has|should|shall)\b/i.test(value)) {
    value = value.replace(/\.$/, "?");
  }

  return value.trim();
}

PocketTTS.prototype.generate = function (text, options = {}) {
  return originalGenerate.call(this, naturalizeText(text), options);
};
