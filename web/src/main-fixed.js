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
let echoGeneration = 0;
let streamQueue = [];
let streamPlaying = false;

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

function clearStreamQueue() { streamQueue.length = 0; }
function stopPlayback() {
  clearStreamQueue();
  if (playback) { try { playback.pause(); playback.removeAttribute("src"); playback.load(); } catch {} playback = null; }
  if (playbackUrl) { URL.revokeObjectURL(playbackUrl); playbackUrl = null; }
}

async function playWav(blob) {
  stopPlayback();
  playbackUrl = URL.createObjectURL(blob);
  playback = new Audio(playbackUrl);
  const device = $("outputDevice")?.value || "default";
  if (device !== "default" && typeof playback.setSinkId === "function") await playback.setSinkId(device);
  playback.onended = () => { if (playbackUrl) URL.revokeObjectURL(playbackUrl); playbackUrl = null; playback = null; };
  await playback.play();
}

async function playStreamQueue() {
  if (streamPlaying) return;
  streamPlaying = true;
  try {
    while (streamQueue.length) {
      const item = streamQueue.shift();
      if (item.generation !== echoGeneration) continue;
      const blob = chunksToWavBlob([item.audio], tts.sampleRate);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const device = $("outputDevice")?.value || "default";
      if (device !== "default" && typeof audio.setSinkId === "function") await audio.setSinkId(device);
      playback = audio; playbackUrl = url;
      await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; audio.play().catch(resolve); });
      try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch {}
      URL.revokeObjectURL(url);
      if (playback === audio) playback = null;
      if (playbackUrl === url) playbackUrl = null;
    }
  } finally { streamPlaying = false; }
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
      const candidate = new PocketTTS({ language: "english_2026-04", quantized: true, voiceCloning: true, cache: true, cacheName: "voicechanger-pocket-tts-v7", maxThreads: Math.min(4, navigator.hardwareConcurrency || 2), modelBaseUrl: base, ortBaseUrl: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/" });
      const info = await candidate.load((p) => { if (p?.total) { const percent = Math.round((p.loaded / p.total) * 100); setProgress(percent); if (percent === 100 || percent % 10 === 0) log(`${p.label || "model"}: ${percent}% (${mb(p.total)})`); } else if (p?.status) log(`Model: ${p.status}`); });
      tts = candidate;
      $("modelInfo").textContent = `Ready • ${tts.sampleRate} Hz • INT8 • ${(info?.predefinedVoices || []).length} voices`;
      $("modelBadge").textContent = "AI ready"; $("modelBadge").style.color = "#83e1aa";
      $("cloneFile").disabled = false; $("recordVoice").disabled = false; setProgress(100);
      status("Pocket TTS ready. Record or upload a voice sample.", "ok"); button.disabled = false; button.textContent = "Reload Pocket TTS";
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
  const clean = text.trim().slice(0, mode === "echo" ? 700 : 1500); if (!clean) return;

  if (mode === "echo") {
    const generation = ++echoGeneration;
    try { tts.stop?.(); } catch {}
    clearStreamQueue(); busy = true; status("Echoing immediately…", "working");
    try {
      const metrics = await tts.generate(clean, { voice: voiceRef, onChunk: (audio) => { const copy = audio.slice(); if (generation !== echoGeneration) return; streamQueue.push({ generation, audio: copy }); void playStreamQueue(); } });
      if (generation === echoGeneration) status(`Echo spoken • ${(metrics?.audioDuration || 0).toFixed(2)}s`, "ok");
    } catch (e) {
      if (generation === echoGeneration) { status(`Echo failed: ${e.message}`, "bad"); log(`ECHO ERROR: ${e.stack || e.message}`); }
    } finally { if (generation === echoGeneration) busy = false; }
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

function downsample(data, from, to = 16000) {
  if (from === to) return data; const ratio = from / to; const out = new Float32Array(Math.round(data.length / ratio)); let offset = 0;
  for (let i = 0; i < out.length; i++) { const end = Math.min(data.length, Math.round((i + 1) * ratio)); let sum = 0, count = 0; for (; offset < end; offset++) { sum += data[offset]; count++; } out[i] = count ? sum / count : 0; }
  return out;
}
function pcm16(data) { const out = new Int16Array(data.length); for (let i = 0; i < data.length; i++) { const s = Math.max(-1, Math.min(1, data[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return out; }
function stopVC() {
  echoGeneration++; busy = false; try { tts?.stop?.(); } catch {} stopPlayback();
  try { processor?.disconnect(); } catch {} try { sourceNode?.disconnect(); } catch {} try { audioContext?.close(); } catch {}
  processor = null; sourceNode = null; audioContext = null; stream?.getTracks().forEach((t) => t.stop()); stream = null; try { socket?.close(); } catch {} socket = null; running = false;
  $("micDot")?.classList.remove("live"); $("startVC").disabled = !voiceRef || !apiKey(); $("stopVC").disabled = true; $("sttInfo").textContent = "VoiceChanger stopped.";
}
async function startVC() {
  if (!apiKey()) throw new Error("Enter your Deepgram API key first."); if (!voiceRef) throw new Error("Clone a voice first."); stopVC();
  stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const key = apiKey();
  socket = new WebSocket("wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&endpointing=100&utterance_end_ms=300", ["token", key]); socket.binaryType = "arraybuffer";
  socket.onopen = () => {
    audioContext = new AudioContext(); sourceNode = audioContext.createMediaStreamSource(stream); processor = audioContext.createScriptProcessor(2048, 1, 1);
    const silent = audioContext.createGain(); silent.gain.value = 0; sourceNode.connect(processor); processor.connect(silent); silent.connect(audioContext.destination);
    processor.onaudioprocess = (event) => { if (!running || socket?.readyState !== WebSocket.OPEN) return; socket.send(pcm16(downsample(event.inputBuffer.getChannelData(0), audioContext.sampleRate)).buffer); };
    running = true; $("micDot").classList.add("live"); $("startVC").disabled = true; $("stopVC").disabled = false; $("sttInfo").textContent = "Deepgram listening — speak normally."; status("STT listening…", "ok"); log("Deepgram connected with low-latency endpointing.");
  };
  socket.onmessage = (event) => { let data; try { data = JSON.parse(event.data); } catch { return; } if (data.type !== "Results") return; const text = data.channel?.alternatives?.[0]?.transcript?.trim(); if (!text) return; $("transcript").textContent = text; if (data.is_final && running) { log(`YOU: ${text}`); void speak(text, "echo"); } };
  socket.onerror = () => log("Deepgram WebSocket error."); socket.onclose = () => { if (running) stopVC(); };
}

$("deepgramKey").value = localStorage.getItem("voicechanger.deepgramKey") || "";
$("deepgramKey").addEventListener("input", () => { localStorage.setItem("voicechanger.deepgramKey", $("deepgramKey").value.trim()); if (voiceRef) $("startVC").disabled = !apiKey(); });
$("loadModel").addEventListener("click", loadModel); $("cloneFile").addEventListener("change", (e) => e.target.files?.[0] && cloneFile(e.target.files[0])); $("recordVoice").addEventListener("click", recordClone); $("generate").addEventListener("click", () => speak($("text").value));
$("stop").addEventListener("click", () => { try { tts?.stop?.(); } catch {} echoGeneration++; busy = false; stopPlayback(); status("Generation stopped."); }); $("refreshOutputs").addEventListener("click", refreshOutputs); $("outputDevice").addEventListener("change", () => localStorage.setItem("voicechanger.outputDevice", $("outputDevice").value));
$("startVC").addEventListener("click", () => startVC().catch((e) => { status(`VoiceChanger failed: ${e.message}`, "bad"); log(`VC ERROR: ${e.message}`); })); $("stopVC").addEventListener("click", stopVC); refreshOutputs();
