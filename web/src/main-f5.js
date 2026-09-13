const $ = (id) => document.getElementById(id);
let referenceBase64 = "";
let referenceName = "";
let referenceText = "";
let running = false;
let busy = false;
let socket = null;
let stream = null;
let audioContext = null;
let processor = null;
let sourceNode = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let manualStop = false;
let playback = null;
let playbackUrl = null;

function log(message) { const box = $("log"); if (box) box.textContent = `${new Date().toLocaleTimeString()} — ${message}\n${box.textContent}`; }
function status(message, type = "") { const el = $("status"); if (el) { el.textContent = message; el.className = `status ${type}`; } }
function voiceStatus(message, type = "") { const el = $("voiceStatus"); if (el) { el.textContent = message; el.className = `status ${type}`; } }
function apiKey() { return $("deepgramKey")?.value.trim() || localStorage.getItem("voicechanger.deepgramKey") || ""; }

function stopPlayback() {
  if (playback) { try { playback.pause(); playback.removeAttribute("src"); playback.load(); } catch {} playback = null; }
  if (playbackUrl) { URL.revokeObjectURL(playbackUrl); playbackUrl = null; }
}

async function playWav(blob) {
  stopPlayback();
  const url = URL.createObjectURL(blob); playbackUrl = url; playback = new Audio(url);
  const wanted = $("outputDevice")?.value || localStorage.getItem("voicechanger.outputDevice") || "default";
  if (wanted !== "default" && typeof playback.setSinkId === "function") { try { await playback.setSinkId(wanted); } catch (e) { log(`OUTPUT DEVICE FAILED: ${e.message}`); } }
  playback.onended = () => { if (playbackUrl === url) { URL.revokeObjectURL(url); playbackUrl = null; } playback = null; };
  await playback.play();
}

async function refreshOutputs() {
  const select = $("outputDevice"); if (!select || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const saved = localStorage.getItem("voicechanger.outputDevice") || "default";
    select.replaceChildren(new Option("Windows default output", "default"));
    for (const d of devices.filter(x => x.kind === "audiooutput" && x.deviceId !== "default")) select.add(new Option(d.label || "Audio output", d.deviceId));
    if ([...select.options].some(o => o.value === saved)) select.value = saved;
  } catch (e) { log(`OUTPUT ERROR: ${e.message}`); }
}

function bytesToBase64(bytes) { let binary = ""; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk)); return btoa(binary); }
async function fileToBase64(file) { return bytesToBase64(new Uint8Array(await file.arrayBuffer())); }

async function selectReference(file) {
  if (!file) return;
  if (!/\.wav$/i.test(file.name)) { voiceStatus("OpenVoice reference must be a WAV file.", "bad"); return; }
  if (file.size > 20_000_000) { voiceStatus("Reference WAV is too large.", "bad"); return; }
  referenceBase64 = await fileToBase64(file); referenceName = file.name;
  voiceStatus(`✓ OpenVoice V2 reference loaded: ${file.name}`, "ok");
  $("generate").disabled = false; $("startVC").disabled = !apiKey();
  log(`OpenVoice V2 reference loaded from ${file.name}.`);
}

async function loadModel() {
  const button = $("loadModel"); if (button) { button.disabled = true; button.textContent = "OpenVoice V2 ready"; }
  $("modelBadge") && ($("modelBadge").textContent = "OpenVoice V2 ready", $("modelBadge").style.color = "#83e1aa");
  $("modelInfo") && ($("modelInfo").textContent = "OpenVoice V2 • local Python engine • model files download on first generation");
  $("cloneFile") && ($("cloneFile").disabled = false);
  $("recordVoice") && ($("recordVoice").disabled = true);
  $("generate") && ($("generate").disabled = !referenceBase64);
  $("progressBar") && ($("progressBar").style.width = "100%");
  status("OpenVoice V2 ready. Load your WAV reference, then generate speech.", "ok");
  await refreshOutputs();
}

async function generate(text, mode = "manual") {
  if (!referenceBase64) { status("Load the WAV voice reference first.", "bad"); return; }
  const clean = String(text || "").trim().slice(0, mode === "conversion" ? 1200 : 1500); if (!clean || busy) return;
  const engine = window.openVoiceTTS || window.f5TTS;
  if (!engine?.generate) { status("OpenVoice V2 desktop engine is missing from this EXE.", "bad"); return; }
  busy = true; status(mode === "conversion" ? "OpenVoice V2 converting…" : "Generating OpenVoice V2 speech…", "working");
  try {
    const result = await engine.generate({ referenceBase64, referenceName, referenceText, text: clean });
    const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    $("preview").src = url; $("preview").hidden = false; $("download").href = url; $("download").download = `voicechanger-openvoice-${Date.now()}.wav`; $("download").classList.remove("hidden");
    await playWav(blob); status(`OpenVoice V2 ready • ${((result.bytes || bytes.length) / 1000).toFixed(0)} KB`, "ok");
  } catch (e) { status(`OpenVoice V2 failed: ${e.message}`, "bad"); log(`OPENVOICE ERROR: ${e.stack || e.message}`); }
  finally { busy = false; }
}

function downsample(data, from, to = 16000) { if (from === to) return data; const ratio = from / to; const out = new Float32Array(Math.round(data.length / ratio)); let offset = 0; for (let i = 0; i < out.length; i++) { const end = Math.min(data.length, Math.round((i + 1) * ratio)); let sum = 0, count = 0; for (; offset < end; offset++) { sum += data[offset]; count++; } out[i] = count ? sum / count : 0; } return out; }
function pcm16(data) { const out = new Int16Array(data.length); for (let i = 0; i < data.length; i++) { const s = Math.max(-1, Math.min(1, data[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return out; }
function cleanup() { try { processor?.disconnect(); } catch {} try { sourceNode?.disconnect(); } catch {} try { audioContext?.close(); } catch {} processor = null; sourceNode = null; audioContext = null; try { stream?.getTracks().forEach(t => t.stop()); } catch {} stream = null; socket = null; $("micDot")?.classList.remove("live"); }
function stopVC() { manualStop = true; if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } cleanup(); $("stopVC").disabled = true; $("startVC").disabled = !referenceBase64 || !apiKey(); status("VoiceChanger stopped."); }

async function startVC() {
  if (!referenceBase64) throw new Error("Load the WAV voice reference first.");
  const key = apiKey(); if (!key) throw new Error("Enter your Deepgram API key first.");
  manualStop = false; running = true; $("startVC").disabled = true; status("Live voice conversion active — OpenVoice V2 will generate each final phrase.", "working");
  stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
  audioContext = new AudioContext(); await audioContext.resume(); sourceNode = audioContext.createMediaStreamSource(stream); processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = e => { if (!socket || socket.readyState !== WebSocket.OPEN) return; try { socket.send(pcm16(downsample(e.inputBuffer.getChannelData(0), audioContext.sampleRate)).buffer); } catch {} };
  sourceNode.connect(processor); processor.connect(audioContext.destination);
  if (window.nativeDeepgram) {
    const id = window.nativeDeepgram.connect(`wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&interim_results=true&smart_format=true&punctuate=true&endpointing=450&encoding=linear16&sample_rate=16000`, ["token", key]);
    socket = { readyState: WebSocket.OPEN, send: data => window.nativeDeepgram.send(id, data), close: () => window.nativeDeepgram.close(id) };
    const poll = setInterval(() => {
      if (!running) { clearInterval(poll); return; }
      for (const ev of window.nativeDeepgram.poll()) {
        if (ev.id !== id) continue;
        if (ev.type === "message") { try { const d = JSON.parse(ev.data); const t = d?.channel?.alternatives?.[0]?.transcript; if (t && d.is_final) void generate(t, "conversion"); } catch {} }
        if (ev.type === "close" && running && !manualStop) { cleanup(); status("Deepgram disconnected — reconnecting…", "working"); reconnectTimer = setTimeout(() => startVC().catch(e => log(`RECONNECT ERROR: ${e.message}`)), Math.min(8000, 500 * 2 ** reconnectAttempts++)); }
      }
    }, 50);
  } else {
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&interim_results=true&smart_format=true&punctuate=true&endpointing=450&encoding=linear16&sample_rate=16000`, ["token", key]);
    socket = ws;
    ws.onopen = () => { $("micDot")?.classList.add("live"); $("stopVC").disabled = false; status("Live voice conversion active.", "ok"); };
    ws.onmessage = e => { try { const d = JSON.parse(e.data); const t = d?.channel?.alternatives?.[0]?.transcript; if (t && d.is_final) void generate(t, "conversion"); } catch {} };
    ws.onclose = () => { if (running && !manualStop) { cleanup(); reconnectTimer = setTimeout(() => startVC().catch(e => log(`RECONNECT ERROR: ${e.message}`)), 1000); } };
  }
  $("micDot")?.classList.add("live"); $("stopVC").disabled = false;
}

function bindUI() {
  $("loadModel")?.addEventListener("click", () => void loadModel());
  $("cloneFile")?.addEventListener("change", e => void selectReference(e.target.files?.[0]));
  $("generate")?.addEventListener("click", () => void generate($("textInput")?.value || $("text")?.value || ""));
  $("startVC")?.addEventListener("click", () => void startVC().catch(e => { status(`Voice conversion failed: ${e.message}`, "bad"); log(`START ERROR: ${e.stack || e.message}`); }));
  $("stopVC")?.addEventListener("click", stopVC);
  $("outputDevice")?.addEventListener("change", e => localStorage.setItem("voicechanger.outputDevice", e.target.value));
  refreshOutputs();
  $("generate") && ($("generate").disabled = true);
  $("cloneFile") && ($("cloneFile").disabled = true);
  $("recordVoice") && ($("recordVoice").disabled = true);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindUI, { once: true }); else bindUI();
