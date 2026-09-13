import { PocketTTS, StreamingPlayer, chunksToWavBlob } from "pocket-tts-js";

const $ = (id) => document.getElementById(id);
let tts = null;
let voiceRef = null;
let player = null;
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
    await applyOutputToPlayback();
  } catch (e) { log(`OUTPUT ERROR: ${e.message}`); }
}

async function applyOutputToPlayback() {
  const wanted = $("outputDevice")?.value || "default";
  if (!playback || typeof playback.setSinkId !== "function") return;
  try { await playback.setSinkId(wanted); } catch (e) { log(`OUTPUT DEVICE FAILED: ${e.message}`); }
}

async function initStreamingPlayer() {
  if (!tts) return;
  if (!player) player = new StreamingPlayer({ sampleRate: tts.sampleRate });
  try { await player.resume(); } catch (e) { log(`STREAM PLAYER WAITING FOR USER AUDIO PERMISSION: ${e.message}`); }
}

function stopPlayback() {
  try { player?.stop?.(); } catch {}
  try { player?.reset?.(); } catch {}
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

async function loadModel() {
  const button = $("loadModel"); if (!button || tts) return;
  button.disabled = true; button.textContent = "Loading…"; setProgress(1);
  const badge = $("modelBadge"); if (badge) { badge.textContent = "Engine loading…"; badge.style.color = "#e9cf88"; }
  status("Starting browser Pocket TTS…", "working");
  log("Loading Pocket TTS with gapless streaming playback.");
  try {
    const candidate = new PocketTTS({ language: "english_2026-04", quantized: true, voiceCloning: true, cache: true, cacheName: "voicechanger-pocket-tts-gapless-v1", maxThreads: 1, modelBaseUrl: MODEL_SOURCE });
    const info = await candidate.load((p) => {
      if (p?.total) { const percent = Math.round((p.loaded / p.total) * 100); setProgress(percent); if (percent === 100 || percent % 10 === 0) log(`${p.label || "model"}: ${percent}% (${mb(p.total)})`); }
      else if (p?.status) log(`Model: ${p.status}`);
    });
    tts = candidate;
    player = new StreamingPlayer({ sampleRate: tts.sampleRate });
    $("modelInfo").textContent = `Ready • ${tts.sampleRate} Hz • INT8 • ${(info?.predefinedVoices || []).length} voices`;
    if (badge) { badge.textContent = "AI ready"; badge.style.color = "#83e1aa"; badge.classList.add("ready"); }
    $("cloneFile").disabled = false; $("recordVoice").disabled = false; setProgress(100);
    status("Pocket TTS ready. Clone a voice to enable live conversion.", "ok");
    button.disabled = false; button.textContent = "Reload Pocket TTS"; await refreshOutputs();
  } catch (e) {
    status("Pocket TTS failed to start in this browser.", "bad"); log(`BROWSER MODEL ERROR: ${e.stack || e.message || e}`);
    if (badge) { badge.textContent = "Engine failed"; badge.style.color = "#ff9eac"; }
    button.disabled = false; button.textContent = "Retry Pocket TTS"; setProgress(0);
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
    status("Converting your voice live…", "working");
    try {
      await initStreamingPlayer();
      await tts.generate(clean, {
        voice: voiceRef,
        onChunk: (audio, meta) => {
          if (generation !== conversionGeneration || !player) return;
          try { player.play(audio, meta); } catch (e) { log(`GAPLESS PLAYER ERROR: ${e.message}`); }
        }
      });
      if (generation === conversionGeneration) player?.flush?.();
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

function queueConversionText(text, final = false) {
  if (!running || !text || !final) return;
  const finalText = text.trim(); if (!finalText) return;
  lastInterimText = ""; conversionBuffer = "";
  if (conversionTimer) { clearTimeout(conversionTimer); conversionTimer = null; }
  conversionQueue.push(finalText); void drainConversionQueue();
}
async function drainConversionQueue() {
  if (conversionWorker || !running || !conversionQueue.length) return;
  conversionWorker = true; const generation = conversionGeneration;
  try { while (conversionQueue.length && running && generation === conversionGeneration) { const chunk = conversionQueue.shift(); await speak(chunk, "conversion"); } }
  finally { if (generation === conversionGeneration) conversionWorker = false; }
}
function downsample(data, from, to = 16000) { if (from === to) return data; const ratio = from / to; const out = new Float32Array(Math.round(data.length / ratio)); let offset = 0; for (let i = 0; i < out.length; i++) { const end = Math.min(data.length, Math.round((i + 1) * ratio)); let sum = 0, count = 0; for (; offset < end; offset++) { sum += data[offset]; count++; } out[i] = count ? sum / count : 0; } return out; }
function pcm16(data) { const out = new Int16Array(data.length); for (let i = 0; i < data.length; i++) { const s = Math.max(-1, Math.min(1, data[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return out; }
function cleanupConnection() { try { processor?.disconnect(); } catch {} try { sourceNode?.disconnect(); } catch {} try { audioContext?.close(); } catch {} processor = null; sourceNode = null; audioContext = null; try { stream?.getTracks().forEach((t) => t.stop()); } catch {} stream = null; socket = null; running = false; $("micDot")?.classList.remove("live"); }
function stopVC() { manualStop = true; reconnectGeneration++; reconnectAttempts = 0; if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } conversionQueue.length = 0; lastInterimText = ""; conversionBuffer = ""; conversionGeneration++; cleanupConnection(); try { player?.stop?.(); player?.reset?.(); } catch {} $("stopVC").disabled = true; $("startVC").disabled = !voiceRef || !apiKey(); status("VoiceChanger stopped."); }

async function startVC() {
  if (!tts) throw new Error("Pocket TTS is still loading."); if (!voiceRef) throw new Error("Clone a voice first.");
  const key = apiKey(); if (!key) throw new Error("Enter your Deepgram API key first.");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access is unavailable. Use HTTPS or localhost in Chrome/Edge.");
  manualStop = false; reconnectGeneration++; reconnectAttempts = 0; conversionGeneration++; running = true;
  await initStreamingPlayer();
  stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
  audioContext = new AudioContext(); await audioContext.resume();
  sourceNode = audioContext.createMediaStreamSource(stream); processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => { if (!socket || socket.readyState !== WebSocket.OPEN) return; const data = downsample(event.inputBuffer.getChannelData(0), audioContext.sampleRate); try { socket.send(pcm16(data).buffer); } catch {} };
  sourceNode.connect(processor); processor.connect(audioContext.destination);
  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&interim_results=true&smart_format=true&punctuate=true&endpointing=450&encoding=linear16&sample_rate=16000`, ["token", key]);
  socket = ws;
  ws.onopen = () => { reconnectAttempts = 0; $("micDot")?.classList.add("live"); $("stopVC").disabled = false; $("startVC").disabled = true; status("Live voice conversion active — gapless playback enabled.", "ok"); };
  ws.onmessage = (event) => { try { const data = JSON.parse(event.data); const alt = data?.channel?.alternatives?.[0]; if (!alt?.transcript) return; queueConversionText(alt.transcript, !!data.is_final); } catch (e) { log(`DEEPGRAM MESSAGE ERROR: ${e.message}`); } };
  ws.onerror = () => log("Deepgram WebSocket error.");
  ws.onclose = () => { if (socket === ws) socket = null; if (!manualStop && running) { cleanupConnection(); status("Deepgram disconnected — reconnecting…", "working"); const delay = Math.min(8000, 500 * 2 ** reconnectAttempts++); reconnectTimer = setTimeout(() => void startVC().catch((e) => log(`RECONNECT ERROR: ${e.message}`)), delay); } };
}

function bindUI() {
  $("loadModel")?.addEventListener("click", () => void loadModel());
  $("cloneFile")?.addEventListener("change", (e) => e.target.files?.[0] && void cloneFile(e.target.files[0]));
  $("recordVoice")?.addEventListener("click", () => void recordClone());
  $("generate")?.addEventListener("click", () => void speak($("text")?.value || ""));
  $("startVC")?.addEventListener("click", () => void startVC().catch((e) => { status(e.message, "bad"); log(`START ERROR: ${e.message}`); }));
  $("stopVC")?.addEventListener("click", stopVC);
  $("deepgramKey")?.addEventListener("input", (e) => { localStorage.setItem("voicechanger.deepgramKey", e.target.value.trim()); $("startVC").disabled = !voiceRef || !e.target.value.trim(); });
  $("outputDevice")?.addEventListener("change", async (e) => { localStorage.setItem("voicechanger.outputDevice", e.target.value); await applyOutputToPlayback(); });
  refreshOutputs();
  $("startVC").disabled = true; $("stopVC").disabled = true;
  queueMicrotask(() => { void loadModel(); });
}
window.addEventListener("DOMContentLoaded", bindUI);
