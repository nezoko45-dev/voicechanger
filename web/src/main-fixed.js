import { PocketTTS, chunksToWavBlob } from "pocket-tts-js";

const $ = (id) => document.getElementById(id);
let tts = null;
let voiceRef = null;
let playback = null;
let playbackUrl = null;
let stream = null;
let audioContext = null;
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

// Browser build: use the official ONNX export. The package supplies its own
// browser ONNX Runtime loader; overriding it with a second CDN was causing
// browser-only failures that did not occur in Electron.
const MODEL_SOURCE = "https://huggingface.co/vlapky/pocket-tts-onnx/resolve/main/onnx";

function log(message) { const box = $("log"); if (box) box.textContent = `${new Date().toLocaleTimeString()} — ${message}\n${box.textContent}`; }
function status(message, type = "") { const el = $("status"); if (el) { el.textContent = message; el.className = `status ${type}`; } }
function voiceStatus(message, type = "") { const el = $("voiceStatus"); if (el) { el.textContent = message; el.className = `status ${type}`; } }
function apiKey() { return $("deepgramKey")?.value.trim() || localStorage.getItem("voicechanger.deepgramKey") || ""; }
function setProgress(percent) { const el = $("progressBar"); if (el) el.style.width = `${Math.max(0, Math.min(100, percent))}%`; }
function mb(n) { return `${(n / 1e6).toFixed(1)} MB`; }

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
    log(`Output selected: ${select.options[select.selectedIndex]?.text || "Windows default output"}`);
    await applyOutputToPlayback();
  } catch (e) { log(`OUTPUT ERROR: ${e.message}`); }
}

async function applyOutputToPlayback() {
  const wanted = $("outputDevice")?.value || "default";
  if (!playback || typeof playback.setSinkId !== "function") return;
  try {
    await playback.setSinkId(wanted);
    const label = $("outputDevice")?.selectedOptions?.[0]?.text || wanted;
    log(`TTS output routed to: ${label}`);
  } catch (e) {
    log(`OUTPUT DEVICE FAILED: ${e.message}`);
    status("Selected output unavailable; using Windows default.", "bad");
  }
}

function stopScheduledAudio() {
  for (const node of scheduledAudio) { try { node.stop(); } catch {} }
  scheduledAudio = [];
  nextAudioTime = 0;
}

function stopPlayback() {
  stopScheduledAudio();
  if (playback) { try { playback.pause(); playback.removeAttribute("src"); playback.load(); } catch {} playback = null; }
  if (playbackUrl) { URL.revokeObjectURL(playbackUrl); playbackUrl = null; }
}

async function playWav(blob) {
  stopPlayback();
  playbackUrl = URL.createObjectURL(blob);
  playback = new Audio(playbackUrl);
  const device = $("outputDevice")?.value || "default";
  if (device !== "default" && typeof playback.setSinkId === "function") {
    try { await playback.setSinkId(device); } catch (e) { log(`OUTPUT DEVICE FAILED: ${e.message}`); }
  }
  playback.onended = () => { if (playbackUrl) URL.revokeObjectURL(playbackUrl); playbackUrl = null; playback = null; };
  await playback.play();
}

function enqueueAudioChunk(audio, generation) {
  if (!audio || generation !== conversionGeneration || !audioContext) return;
  try {
    const samples = audio instanceof Float32Array ? audio : new Float32Array(audio);
    if (!samples.length) return;
    const buffer = audioContext.createBuffer(1, samples.length, tts.sampleRate);
    buffer.copyToChannel(samples, 0);
    const now = audioContext.currentTime;
    const start = nextAudioTime > now + 0.005 ? nextAudioTime : now + 0.005;
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    const gain = audioContext.createGain();
    gain.gain.value = 1;
    source.connect(gain).connect(audioContext.destination);
    source.start(start);
    nextAudioTime = start + buffer.duration;
    scheduledAudio.push(source);
    source.onended = () => { scheduledAudio = scheduledAudio.filter((n) => n !== source); };
  } catch (e) { log(`AUDIO SCHEDULE ERROR: ${e.message}`); }
}

async function loadModel() {
  const button = $("loadModel");
  if (!button || tts) return;
  button.disabled = true;
  button.textContent = "Loading…";
  const badge = $("modelBadge");
  if (badge) { badge.textContent = "Engine loading…"; badge.style.color = "#e9cf88"; }
  setProgress(1);
  status("Starting browser Pocket TTS…", "working");
  log("Browser engine: Chrome/Edge mode");
  log(`Loading official Pocket TTS ONNX export: ${MODEL_SOURCE}`);
  try {
    const candidate = new PocketTTS({
      language: "english_2026-04",
      quantized: true,
      voiceCloning: true,
      cache: true,
      cacheName: "voicechanger-pocket-tts-chrome-edge-v1",
      // Normal Chrome/Edge tabs work without SharedArrayBuffer. One worker is
      // slower than Electron but avoids requiring cross-origin isolation.
      maxThreads: 1,
      modelBaseUrl: MODEL_SOURCE
    });
    const info = await candidate.load((p) => {
      if (p?.total) {
        const percent = Math.round((p.loaded / p.total) * 100);
        setProgress(percent);
        if (percent === 100 || percent % 10 === 0) log(`${p.label || "model"}: ${percent}% (${mb(p.total)})`);
      } else if (p?.status) log(`Model: ${p.status}`);
    });
    tts = candidate;
    $("modelInfo").textContent = `Ready • ${tts.sampleRate} Hz • INT8 • ${(info?.predefinedVoices || []).length} voices`;
    if (badge) { badge.textContent = "AI ready"; badge.style.color = "#83e1aa"; badge.classList.add("ready"); }
    $("cloneFile").disabled = false;
    $("recordVoice").disabled = false;
    setProgress(100);
    status("Pocket TTS ready in Chrome/Edge. Clone a voice to enable live conversion.", "ok");
    button.disabled = false;
    button.textContent = "Reload Pocket TTS";
    log("Browser Pocket TTS loaded successfully.");
    await refreshOutputs();
  } catch (e) {
    const message = e?.stack || e?.message || String(e);
    status("Pocket TTS failed to start in this browser.", "bad");
    log(`BROWSER MODEL ERROR: ${message}`);
    if (badge) { badge.textContent = "Engine failed"; badge.style.color = "#ff9eac"; }
    button.disabled = false;
    button.textContent = "Retry Pocket TTS";
    setProgress(0);
  }
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
  if (!tts) { status("Pocket TTS is still loading.", "bad"); return; }
  if (!voiceRef) { status("Clone a voice first.", "bad"); return; }
  const clean = text.trim().slice(0, mode === "conversion" ? 2000 : 1500); if (!clean) return;
  if (mode === "conversion") {
    const generation = conversionGeneration;
    conversionWorker = true;
    status("Converting your voice live…", "working");
    try { await tts.generate(clean, { voice: voiceRef, onChunk: (audio) => enqueueAudioChunk(audio, generation) }); }
    catch (e) { if (generation === conversionGeneration) { status(`Voice conversion failed: ${e.message}`, "bad"); log(`CONVERSION ERROR: ${e.stack || e.message}`); } }
    finally { if (generation === conversionGeneration) conversionWorker = false; }
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
function getInterimDelta(previous, current) { const a = normalizedWords(previous); const b = normalizedWords(current); let common = 0; while (common < a.length && common < b.length && a[common] === b[common]) common++; if (common === a.length && b.length >= a.length) return b.slice(common).join(" "); return b.slice(Math.max(0, common)).join(" "); }
function queueConversionText(text, final = false) { if (!running || !text) return; if (!final) { lastInterimText = text; return; } const finalText = text.trim(); if (!finalText) return; lastInterimText = ""; conversionBuffer = ""; if (conversionTimer) { clearTimeout(conversionTimer); conversionTimer = null; } conversionQueue.push(finalText); void drainConversionQueue(); }
async function drainConversionQueue() { if (conversionWorker || !running || !conversionQueue.length) return; conversionWorker = true; const generation = conversionGeneration; try { while (conversionQueue.length && running && generation === conversionGeneration) { const chunk = conversionQueue.shift(); await speak(chunk, "conversion"); } } finally { if (generation === conversionGeneration) conversionWorker = false; } }
function downsample(data, from, to = 16000) { if (from === to) return data; const ratio = from / to; const out = new Float32Array(Math.round(data.length / ratio)); let offset = 0; for (let i = 0; i < out.length; i++) { const end = Math.min(data.length, Math.round((i + 1) * ratio)); let sum = 0, count = 0; for (; offset < end; offset++) { sum += data[offset]; count++; } out[i] = count ? sum / count : 0; } return out; }
function pcm16(data) { const out = new Int16Array(data.length); for (let i = 0; i < data.length; i++) { const s = Math.max(-1, Math.min(1, data[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return out; }

function cleanupConnection() {
  try { processor?.disconnect(); } catch {}
  try { sourceNode?.disconnect(); } catch {}
  try { audioContext?.close(); } catch {}
  processor = null; sourceNode = null; audioContext = null;
  try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
  stream = null; socket = null; running = false; $("micDot")?.classList.remove("live");
}
function stopVC() { manualStop = true; reconnectGeneration++; reconnectAttempts = 0; if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } if (conversionTimer) { clearTimeout(conversionTimer); conversionTimer = null; } conversionBuffer = ""; conversionQueue.length = 0; lastInterimText = ""; conversionGeneration++; cleanupConnection(); $("stopVC").disabled = true; $("startVC").disabled = !voiceRef || !apiKey(); status("VoiceChanger stopped."); }

async function startVC() {
  if (!tts) throw new Error("Pocket TTS is still loading.");
  if (!voiceRef) throw new Error("Clone a voice first.");
  const key = apiKey(); if (!key) throw new Error("Enter your Deepgram API key first.");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access is unavailable. Use HTTPS or localhost in Chrome/Edge.");
  manualStop = false; reconnectAttempts = 0; reconnectGeneration++; const generation = reconnectGeneration;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  cleanupConnection();
  stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  audioContext = new AudioContext(); await audioContext.resume();
  sourceNode = audioContext.createMediaStreamSource(stream);
  processor = audioContext.createScriptProcessor(4096, 1, 1);
  sourceNode.connect(processor); processor.connect(audioContext.destination);
  socket = new WebSocket(`wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&punctuate=true`, ["token", key]);
  const ws = socket;
  ws.onopen = () => { if (generation !== reconnectGeneration) return; running = true; reconnectAttempts = 0; $("micDot")?.classList.add("live"); $("sttInfo").textContent = "Listening"; $("startVC").disabled = true; $("stopVC").disabled = false; status("Listening with Deepgram…", "ok"); log("Deepgram WebSocket connected."); };
  ws.onmessage = (event) => {
    if (generation !== reconnectGeneration) return;
    try {
      const data = JSON.parse(event.data);
      const text = data?.channel?.alternatives?.[0]?.transcript?.trim() || "";
      if (text) { $("transcript").textContent = text; $("transcript").dataset.interim = String(!data?.is_final); queueConversionText(text, !!data?.is_final); }
    } catch (e) { log(`DEEPGRAM MESSAGE ERROR: ${e.message}`); }
  };
  ws.onerror = () => { if (generation === reconnectGeneration) log("Deepgram WebSocket error."); };
  ws.onclose = (event) => {
    if (generation !== reconnectGeneration || manualStop) return;
    log(`Deepgram disconnected (${event.code}).`);
    cleanupConnection();
    if (reconnectAttempts < 5) { reconnectAttempts++; const delay = Math.min(1000 * (2 ** (reconnectAttempts - 1)), 10000); status(`Reconnecting to Deepgram in ${Math.round(delay / 1000)}s…`, "working"); reconnectTimer = setTimeout(() => startVC().catch((e) => log(`RECONNECT ERROR: ${e.message}`)), delay); }
    else { status("Deepgram connection ended. Press Start to retry.", "bad"); $("startVC").disabled = !voiceRef || !apiKey(); }
  };
  processor.onaudioprocess = (event) => {
    if (generation !== reconnectGeneration || !socket || socket.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0); const data = downsample(input, audioContext.sampleRate, 16000); socket.send(pcm16(data).buffer);
  };
}

function bindUI() {
  $("loadModel")?.addEventListener("click", () => loadModel());
  $("cloneFile")?.addEventListener("change", (e) => { const file = e.target.files?.[0]; if (file) cloneFile(file); });
  $("recordVoice")?.addEventListener("click", recordClone);
  $("generate")?.addEventListener("click", () => speak($("text")?.value || ""));
  $("stop")?.addEventListener("click", stopPlayback);
  $("startVC")?.addEventListener("click", () => startVC().catch((e) => { status(e.message, "bad"); log(`START ERROR: ${e.message}`); }));
  $("stopVC")?.addEventListener("click", stopVC);
  $("outputDevice")?.addEventListener("change", async () => { const value = $("outputDevice").value || "default"; localStorage.setItem("voicechanger.outputDevice", value); await applyOutputToPlayback(); });
  $("refreshOutputs")?.addEventListener("click", refreshOutputs);
  const keyInput = $("deepgramKey");
  if (keyInput) { keyInput.value = localStorage.getItem("voicechanger.deepgramKey") || ""; keyInput.addEventListener("input", () => { localStorage.setItem("voicechanger.deepgramKey", keyInput.value.trim()); $("startVC").disabled = !voiceRef || !apiKey(); }); }
  refreshOutputs();
  $("startVC").disabled = true;
  $("stopVC").disabled = true;
  queueMicrotask(() => { void loadModel(); });
}

window.addEventListener("DOMContentLoaded", bindUI);