const $ = (id) => document.getElementById(id);
let rvcStream = null;
let rvcRecorder = null;
let rvcBusy = false;
let rvcRunning = false;
let rvcPlayback = null;
let rvcUrl = null;

function rvcLog(message) {
  const box = $("log");
  if (box) box.textContent = `${new Date().toLocaleTimeString()} — RVC: ${message}\n${box.textContent}`;
}
function rvcStatus(message, type = "") {
  const el = $("rvcStatus");
  if (el) { el.textContent = message; el.className = `status ${type}`; }
}
function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true); }
  return new Uint8Array(buffer);
}
function toBase64(bytes) {
  let out = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) out += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  return btoa(out);
}
async function blobToWavBase64(blob) {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) { let total = 0; for (let c = 0; c < decoded.numberOfChannels; c++) total += decoded.getChannelData(c)[i] || 0; mono[i] = total / decoded.numberOfChannels; }
    const target = 16000;
    let samples = mono;
    if (decoded.sampleRate !== target) {
      const ratio = decoded.sampleRate / target;
      samples = new Float32Array(Math.round(mono.length / ratio));
      let offset = 0;
      for (let i = 0; i < samples.length; i++) { const end = Math.min(mono.length, Math.round((i + 1) * ratio)); let sum = 0, count = 0; for (; offset < end; offset++) { sum += mono[offset]; count++; } samples[i] = count ? sum / count : 0; }
    }
    return toBase64(encodeWav(samples, target));
  } finally { await ctx.close(); }
}
async function playRvcBase64(base64) {
  if (rvcUrl) { URL.revokeObjectURL(rvcUrl); rvcUrl = null; }
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  rvcUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  if (!rvcPlayback) rvcPlayback = new Audio();
  rvcPlayback.src = rvcUrl;
  const device = $("outputDevice")?.value || "default";
  if (device !== "default" && typeof rvcPlayback.setSinkId === "function") { try { await rvcPlayback.setSinkId(device); } catch {} }
  await rvcPlayback.play();
}
async function convertChunk(blob) {
  if (!window.voicechangerRvc?.convertWav) throw new Error("RVC Pocket bridge is unavailable.");
  const wav = await blobToWavBase64(blob);
  const voiceId = $("rvcVoice")?.value || "default";
  const retrievalBlend = Number($("rvcBlend")?.value || 0);
  const output = await window.voicechangerRvc.convertWav(wav, { voiceId, retrievalBlend });
  await playRvcBase64(output);
}
async function ensureRvcReady() {
  if (!window.voicechangerRvc) throw new Error("RVC Pocket is only available in the desktop EXE.");
  rvcStatus("Preparing local RVC engine/model…", "working");
  const status = await window.voicechangerRvc.getStatus();
  if (!status.engine) throw new Error("The RVC Pocket engine is missing from this build.");
  if (!status.model) await window.voicechangerRvc.ensureModel();
  rvcStatus("RVC Pocket ready • local conversion", "ok");
}
async function startRvcPocket() {
  if (rvcRunning) return;
  try {
    await ensureRvcReady();
    rvcStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find(v => MediaRecorder.isTypeSupported(v)) || "";
    rvcRecorder = new MediaRecorder(rvcStream, mime ? { mimeType: mime } : undefined);
    rvcRunning = true; rvcBusy = false;
    $("startRvc").disabled = true; $("stopRvc").disabled = false; $("rvcDot")?.classList.add("live");
    rvcStatus("Listening • converting locally", "working");
    rvcRecorder.ondataavailable = async (event) => {
      if (!event.data.size || !rvcRunning || rvcBusy) return;
      rvcBusy = true;
      try { await convertChunk(event.data); } catch (e) { rvcLog(`CONVERSION ERROR: ${e.message}`); rvcStatus(`RVC error: ${e.message}`, "bad"); } finally { rvcBusy = false; }
    };
    rvcRecorder.onerror = (event) => rvcLog(`RECORDER ERROR: ${event.error?.message || "unknown"}`);
    rvcRecorder.start(1800);
    rvcLog("RVC Pocket started. 1.8-second local conversion chunks are active.");
  } catch (e) { rvcStatus(`RVC failed: ${e.message}`, "bad"); rvcLog(e.message); stopRvcPocket(); }
}
function stopRvcPocket() {
  rvcRunning = false;
  try { rvcRecorder?.stop(); } catch {}
  rvcRecorder = null;
  try { rvcStream?.getTracks().forEach(t => t.stop()); } catch {}
  rvcStream = null;
  if (rvcPlayback) { try { rvcPlayback.pause(); rvcPlayback.src = ""; } catch {} }
  if (rvcUrl) { URL.revokeObjectURL(rvcUrl); rvcUrl = null; }
  $("startRvc") && ($("startRvc").disabled = false);
  $("stopRvc") && ($("stopRvc").disabled = true);
  $("rvcDot")?.classList.remove("live");
  rvcStatus("RVC Pocket stopped.");
}

window.addEventListener("DOMContentLoaded", () => {
  $("startRvc")?.addEventListener("click", startRvcPocket);
  $("stopRvc")?.addEventListener("click", stopRvcPocket);
  $("rvcBlend")?.addEventListener("input", () => { const v = $("rvcBlendValue"); if (v) v.textContent = Number($("rvcBlend").value).toFixed(2); });
});
