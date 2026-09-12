import { PocketTTS, chunksToWavBlob } from "pocket-tts-js";

const $ = (id) => document.getElementById(id);
let tts = null;
let voiceRef = null;
let stream = null;
let audioContext = null;
let outputAudioContext = null;
let processor = null;
let sourceNode = null;
let socket = null;
let running = false;
let busy = false;
let manualStop = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let reconnectGeneration = 0;

let lastInterimText = "";
let conversionBuffer = "";
let conversionTimer = null;
let conversionQueue = [];
let conversionWorker = false;
let conversionGeneration = 0;
let scheduledAudio = [];
let nextAudioTime = 0;

const MODEL_SOURCES = [
  "https://huggingface.co/akrv/pocket-tts-onnx/resolve/main/onnx",
  "https://huggingface.co/lookbe/pocket-tts-onnx-v2/resolve/main/onnx",
  "https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/main/onnx"
];

function log(message) { const box = $("log"); if (box) box.textContent = `${new Date().toLocaleTimeString()} — ${message}\n${box.textContent}`; }
function status(message, type = "") { const el = $("status"); if (el) { el.textContent = message; el.className = `status ${type}`; } }
function voiceStatus(message, type = "") { const el = $("voiceStatus"); if (el) { el.textContent = message; el.className = `status ${type}`; } }
function apiKey() { return $("deepgramKey")?.value.trim() || localStorage.getItem("voicechanger.deepgramKey") || ""; }
function setProgress(percent) { const el = $("progressBar"); if (el) el.style.width = `${Math.max(0, Math.min(100, percent))}%`; }
function mb(n) { return `${(n / 1e6).toFixed(1)} MB`; }
function selectedOutputDevice() { return $("outputDevice")?.value || localStorage.getItem("voicechanger.outputDevice") || "default"; }

async function refreshOutputs() {
  const select = $("outputDevice");
  if (!select || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    const saved = localStorage.getItem("voicechanger.outputDevice") || "default";
    select.replaceChildren(new Option("Windows default output", "default"));
    for (const device of outputs) if (device.deviceId !== "default") select.add(new Option(device.label || "Audio output", device.deviceId));
    if ([...select.options].some((o) => o.value === saved)) select.value = saved;
  } catch (e) { log(`OUTPUT ERROR: ${e.message}`); }
}

async function ensureOutputAudioContext() {
  const wanted = selectedOutputDevice();
  if (!outputAudioContext || outputAudioContext.state === "closed") {
    try {
      outputAudioContext = wanted !== "default" ? new AudioContext({ sinkId: wanted }) : new AudioContext();
    } catch (e) {
      log(`OUTPUT CONTEXT FALLBACK: ${e.message}`);
      outputAudioContext = new AudioContext();
    }
  }
  try { if (outputAudioContext.state === "suspended") await outputAudioContext.resume(); } catch {}
  if (wanted !== "default" && typeof outputAudioContext.setSinkId === "function") {
    try { await outputAudioContext.setSinkId(wanted); }
    catch (e) { log(`OUTPUT DEVICE FAILED: ${e.message}`); status("Selected output unavailable; using Windows default.", "bad"); }
  }
  return outputAudioContext;
}

function stopScheduledAudio() {
  for (const node of scheduledAudio) { try { node.stop(); } catch {} }
  scheduledAudio = [];
  nextAudioTime = 0;
}

function stopPlayback() { stopScheduledAudio(); }

async function playWav(blob) {
  stopPlayback();
  const ctx = await ensureOutputAudioContext();
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  const start = Math.max(ctx.currentTime + 0.01, nextAudioTime || 0);
  source.start(start);
  nextAudioTime = start + buffer.duration;
  scheduledAudio.push(source);
  source.onended = () => { scheduledAudio = scheduledAudio.filter((n) => n !== source); };
}

function enqueueAudioChunk(audio, generation, ctx) {
  if (!audio || generation !== conversionGeneration || !ctx) return;
  try {
    const samples = audio instanceof Float32Array ? audio : new Float32Array(audio);
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, tts.sampleRate);
    buffer.copyToChannel(samples, 0);
    const now = ctx.currentTime;
    if (!nextAudioTime || nextAudioTime < now + 0.02) nextAudioTime = now + 0.03;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(nextAudioTime);
    nextAudioTime += buffer.duration;
    scheduledAudio.push(source);
    source.onended = () => { scheduledAudio = scheduledAudio.filter((n) => n !== source); };
  } catch (e) { log(`AUDIO SCHEDULE ERROR: ${e.message}`); }
}

async function loadModel() {
  const button = $("loadModel"); if (!button) return;
  button.disabled = true; button.textContent = "Loading…"; setProgress(1);
  const errors = [];
  for (let i = 0; i < MODEL_SOURCES.length; i++) {
    const base = MODEL_SOURCES[i];
    try {
      const bundle = `${base}/english_2026-04`;
      status(`Loading Pocket TTS mirror ${i + 1}/${MODEL_SOURCES.length}…`, "working"); log(`Trying model mirror: ${bundle}`);
      try { tts?.destroy?.(); } catch {}
      const candidate = new PocketTTS({ language: "english_2026-04", quantized: true, voiceCloning: true, cache: true, cacheName: "voicechanger-pocket-tts-v8", maxThreads: Math.min(4, navigator.hardwareConcurrency || 2), modelBaseUrl: base, ortBaseUrl: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/" });
      const info = await candidate.load((p) => { if (p?.total) { const percent = Math.round((p.loaded / p.total) * 100); setProgress(percent); if (percent === 100 || percent % 10 === 0) log(`${p.label || "model"}: ${percent}% (${mb(p.total)})`); } else if (p?.status) log(`Model: ${p.status}`); });
      tts = candidate;
      $("modelInfo").textContent = `Ready • ${tts.sampleRate} Hz • INT8 • ${(info?.predefinedVoices || []).length} voices`;
      $("modelBadge").textContent = "AI ready"; $("modelBadge").style.color = "#83e1aa";
      $("cloneFile").disabled = false; $("recordVoice").disabled = false; setProgress(100);
      status("Pocket TTS ready. Clone a voice to enable live conversion.", "ok"); button.disabled = false; button.textContent = "Reload Pocket TTS";
      log(`Pocket TTS loaded from mirror ${i + 1}.`); await refreshOutputs(); return;
    } catch (e) { const message = e?.message || String(e); errors.push(`Mirror ${i + 1}: ${message}`); log(`MIRROR ${i + 1} FAILED: ${message}`); }
  }
  status("Pocket TTS could not load from any mirror.", "bad"); log(`MODEL ERROR: ${errors.join(" | ")}`); button.disabled = false; button.textContent = "Retry Pocket TTS"; setProgress(0);
}

async function cloneAudio(blob, name) {
  if (!tts) throw new Error("Load Pocket TTS first.");
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buffer.duration < 2) throw new Error("Use at least 2 seconds of speech.");
    if (buffer.duration > 30) throw new Error("Keep the sample under 30 seconds.");
    const mono = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) { let total = 0; for (let c = 0; c < buffer.numberOfChannels; c++) total += buffer.getChannelData(c)[i] || 0; mono[i] = total / buffer.numberOfChannels; }
    voiceRef = await tts.cloneVoice(mono, { inputSampleRate: buffer.sampleRate, name: `clone:${name}:${Date.now()}` });
  } finally { await ctx.close(); }
  voiceStatus(`✓ Voice cloned: ${name}`, "ok"); $("generate").disabled = false; $("startVC").disabled = !apiKey(); log(`Voice clone created from ${name}.`);
}
async function cloneFile(file) { $("cloneFile").disabled = true; voiceStatus("Analyzing voice sample…", "working"); try { await cloneAudio(file, file.name); } catch (e) { voiceStatus(`Clone failed: ${e.message}`, "bad"); log(`CLONE ERROR: ${e.message}`); } finally { $("cloneFile").disabled = false; } }
async function recordClone() {
  if (!tts) { voiceStatus("Load Pocket TTS first.", "bad"); return; }
  try {
    const input = await navigator.mediaDevices.getUserMedia({ audio: true }); const recorder = new MediaRecorder(input); const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => { input.getTracks().forEach((t) => t.stop()); $("recordVoice").disabled = false; $("stopRecord").disabled = true; try { await cloneAudio(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), "microphone recording"); } catch (e) { voiceStatus(`Clone failed: ${e.message}`, "bad"); log(`MIC CLONE ERROR: ${e.message}`); } };
    recorder.start(); $("recordVoice").disabled = true; $("stopRecord").disabled = false; voiceStatus("🔴 Recording… speak clearly for 3–15 seconds.", "working"); $("stopRecord").onclick = () => recorder.state !== "inactive" && recorder.stop();
  } catch (e) { voiceStatus(`Microphone failed: ${e.message}`, "bad"); }
}

async function speak(text, mode = "manual") {
  if (!tts) { status("Load Pocket TTS first.", "bad"); return; }
  if (!voiceRef) { status("Clone a voice first.", "bad"); return; }
  const clean = text.trim().slice(0, mode === "conversion" ? 500 : 1500); if (!clean) return;
  if (mode === "conversion") {
    const generation = conversionGeneration;
    const ctx = await ensureOutputAudioContext();
    status("Converting your voice live…", "working");
    try {
      await tts.generate(clean, { voice: voiceRef, onChunk: (audio) => enqueueAudioChunk(audio, generation, ctx) });
    } catch (e) {
      if (generation === conversionGeneration) { status(`Voice conversion failed: ${e.message}`, "bad"); log(`CONVERSION ERROR: ${e.stack || e.message}`); }
    }
    return;
  }
  if (busy) return; busy = true;
  try {
    status("Generating cloned speech…", "working"); const chunks = [];
    const metrics = await tts.generate(clean, { voice: voiceRef, onChunk: (audio) => chunks.push(audio.slice()) });
    if (!chunks.length) throw new Error("No audio was generated.");
    const blob = chunksToWavBlob(chunks, tts.sampleRate); const url = URL.createObjectURL(blob);
    $("preview").src = url; $("preview").hidden = false; $("download").href = url; $("download").download = `voicechanger-${Date.now()}.wav`; $("download").classList.remove("hidden");
    await playWav(blob); status(`Spoken • ${(metrics?.audioDuration || 0).toFixed(2)}s`, "ok");
  } catch (e) { status(`TTS failed: ${e.message}`, "bad"); log(`TTS ERROR: ${e.stack || e.message}`); } finally { busy = false; }
}

function normalizedWords(text) { return text.toLowerCase().replace(/[\u2018\u2019]/g, "'").split(/\s+/).filter(Boolean); }
function getInterimDelta(previous, current) {
  const a = normalizedWords(previous); const b = normalizedWords(current); let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  if (common === a.length && b.length >= a.length) return b.slice(common).join(" ");
  return b.slice(Math.max(0, common)).join(" ");
}
function queueConversionText(text, final = false) {
  if (!running || !text) return;
  const delta = getInterimDelta(lastInterimText, text); lastInterimText = text;
  if (delta) conversionBuffer = `${conversionBuffer} ${delta}`.trim();
  if (conversionTimer) { clearTimeout(conversionTimer); conversionTimer = null; }
  const words = conversionBuffer.split(/\s+/).filter(Boolean);
  if (words.length >= 3 || final) {
    const count = final ? words.length : Math.min(4, words.length); const chunk = words.splice(0, count).join(" "); conversionBuffer = words.join(" ");
    if (chunk) { conversionQueue.push(chunk); void drainConversionQueue(); }
  } else if (words.length) {
    conversionTimer = setTimeout(() => {
      conversionTimer = null; const pending = conversionBuffer.split(/\s+/).filter(Boolean); if (!pending.length) return;
      const count = Math.min(3, pending.length); const chunk = pending.splice(0, count).join(" "); conversionBuffer = pending.join(" ");
      if (chunk) { conversionQueue.push(chunk); void drainConversionQueue(); }
    }, 120);
  }
  if (final) lastInterimText = "";
}
async function drainConversionQueue() {
  if (conversionWorker || !running || !conversionQueue.length) return;
  conversionWorker = true; const generation = conversionGeneration;
  try { while (conversionQueue.length && running && generation === conversionGeneration) { const chunk = conversionQueue.shift(); await speak(chunk, "conversion"); } }
  finally { if (generation === conversionGeneration) conversionWorker = false; }
}

function downsample(data, from, to = 16000) {
  if (from === to) return data; const ratio = from / to; const out = new Float32Array(Math.round(data.length / ratio)); let offset = 0;
  for (let i = 0; i < out.length; i++) { const end = Math.min(data.length, Math.round((i + 1) * ratio)); let sum = 0, count = 0; for (; offset < end; offset++) { sum += data[offset]; count++; } out[i] = count ? sum / count : 0; }
  return out;
}
function pcm16(data) { const out = new Int16Array(data.length); for (let i = 0; i < data.length; i++) { const s = Math.max(-1, Math.min(1, data[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return out; }

function cleanupConnection() {
  try { processor?.disconnect(); } catch {}
  try { sourceNode?.disconnect(); } catch {}
  try { audioContext?.close(); } catch {}
  processor = null; sourceNode = null; audioContext = null;
  try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
  stream = null; socket = null; running = false; $("micDot")?.classList.remove("live");
}
function stopVC() {
  manualStop = true; reconnectGeneration++; reconnectAttempts = 0;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (conversionTimer) { clearTimeout(conversionTimer); conversionTimer = null; }
  conversionBuffer = ""; conversionQueue.length = 0; lastInterimText = ""; conversionGeneration++;
  try { tts?.stop?.(); } catch {} stopPlayback(); const oldSocket = socket; cleanupConnection();
  try { oldSocket?.close(1000, "User stopped VoiceChanger"); } catch {}
  $("startVC").disabled = !voiceRef || !apiKey(); $("stopVC").disabled = true; $("sttInfo").textContent = "VoiceChanger stopped.";
}
function scheduleReconnect(generation, reason) {
  if (manualStop || generation !== reconnectGeneration || !apiKey() || !voiceRef) return;
  if (reconnectTimer) return; reconnectAttempts += 1; const delay = Math.min(5000, 400 * Math.pow(2, reconnectAttempts - 1));
  status(`Reconnecting to Deepgram in ${(delay / 1000).toFixed(1)}s…`, "working"); log(`Deepgram disconnected (${reason || "closed"}); reconnect attempt ${reconnectAttempts}.`);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; if (!manualStop && generation === reconnectGeneration) startVC(true).catch((e) => { log(`RECONNECT ERROR: ${e.message}`); scheduleReconnect(generation, e.message); }); }, delay);
}

async function startVC(isReconnect = false) {
  if (!apiKey()) throw new Error("Enter your Deepgram API key first.");
  if (!voiceRef) throw new Error("Clone a voice first.");
  if (!isReconnect) { stopVC(); manualStop = false; reconnectGeneration++; reconnectAttempts = 0; }
  const generation = reconnectGeneration;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  cleanupConnection(); conversionGeneration++; conversionBuffer = ""; conversionQueue.length = 0; lastInterimText = ""; conversionWorker = false;
  await ensureOutputAudioContext();
  stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const key = apiKey();
  const url = "wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&endpointing=300&utterance_end_ms=1000";
  const ws = new WebSocket(url, ["token", key]); socket = ws; ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    if (ws !== socket || manualStop || generation !== reconnectGeneration) { try { ws.close(); } catch {} return; }
    reconnectAttempts = 0; audioContext = new AudioContext(); if (audioContext.state === "suspended") void audioContext.resume();
    sourceNode = audioContext.createMediaStreamSource(stream); processor = audioContext.createScriptProcessor(2048, 1, 1);
    const silent = audioContext.createGain(); silent.gain.value = 0; sourceNode.connect(processor); processor.connect(silent); silent.connect(audioContext.destination);
    processor.onaudioprocess = (event) => { if (!running || ws.readyState !== WebSocket.OPEN) return; try { ws.send(pcm16(downsample(event.inputBuffer.getChannelData(0), audioContext.sampleRate)).buffer); } catch {} };
    running = true; $("micDot")?.classList.add("live"); $("startVC").disabled = true; $("stopVC").disabled = false;
    $("sttInfo").textContent = "LIVE VOICE CONVERSION — your speech is converted to the cloned voice."; status("Live voice conversion • selected output • cutout protection enabled", "ok"); log("Deepgram connected — output-routed live conversion active.");
  };
  ws.onmessage = (event) => { let data; try { data = JSON.parse(event.data); } catch { return; } if (data.type !== "Results") return; const alt = data.channel?.alternatives?.[0]; const text = alt?.transcript?.trim(); if (!text) return; $("transcript").textContent = text; if (running) { queueConversionText(text, !!data.is_final); if (data.is_final) log(`YOU: ${text}`); } };
  ws.onerror = () => log("Deepgram WebSocket error; reconnecting automatically.");
  ws.onclose = (event) => { if (!manualStop && generation === reconnectGeneration) { cleanupConnection(); scheduleReconnect(generation, `${event.code}${event.reason ? ` ${event.reason}` : ""}`); } };
}

$("deepgramKey").value = localStorage.getItem("voicechanger.deepgramKey") || "";
$("deepgramKey").addEventListener("input", () => { localStorage.setItem("voicechanger.deepgramKey", $("deepgramKey").value.trim()); if (voiceRef) $("startVC").disabled = !apiKey(); });
$("loadModel").addEventListener("click", loadModel); $("cloneFile").addEventListener("change", (e) => e.target.files?.[0] && cloneFile(e.target.files[0])); $("recordVoice").addEventListener("click", recordClone); $("generate").addEventListener("click", () => speak($("text").value));
$("stop").addEventListener("click", () => { try { tts?.stop?.(); } catch {} conversionGeneration++; conversionQueue.length = 0; stopScheduledAudio(); busy = false; status("Generation stopped."); });
$("refreshOutputs").addEventListener("click", refreshOutputs);
$("outputDevice").addEventListener("change", async () => { localStorage.setItem("voicechanger.outputDevice", $("outputDevice").value); stopScheduledAudio(); try { if (outputAudioContext && outputAudioContext.state !== "closed") await outputAudioContext.setSinkId($("outputDevice").value); else await ensureOutputAudioContext(); status("Audio output changed.", "ok"); } catch (e) { log(`OUTPUT CHANGE ERROR: ${e.message}`); status("Could not switch output device.", "bad"); } });
$("startVC").addEventListener("click", () => startVC().catch((e) => { status(`VoiceChanger failed: ${e.message}`, "bad"); log(`VC ERROR: ${e.message}`); }));
$("stopVC").addEventListener("click", stopVC);
refreshOutputs();