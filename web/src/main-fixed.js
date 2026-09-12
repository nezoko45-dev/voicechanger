import { PocketTTS, chunksToWavBlob } from "pocket-tts-js";

const $ = (id) => document.getElementById(id);
let tts = null;
let voiceRef = null;
let playbackAudio = null;
let playbackUrl = null;
let generating = false;
let mediaStream = null;
let audioContext = null;
let processor = null;
let sourceNode = null;
let sttSocket = null;
let sttRunning = false;
let echoQueue = Promise.resolve();

// Pocket TTS v2 models live inside the per-language bundle.
const MODEL_SOURCES = [
  "https://huggingface.co/vlapky/pocket-tts-onnx/resolve/main/onnx/english_2026-04",
  "https://huggingface.co/KevinAHM/pocket-tts-web/resolve/main/onnx/english_2026-04",
  "https://hf-mirror.com/vlapky/pocket-tts-onnx/resolve/main/onnx/english_2026-04"
];

function log(message) {
  const box = $("log");
  if (box) box.textContent = `${new Date().toLocaleTimeString()} — ${message}\n${box.textContent}`;
}
function status(text, type = "") {
  const el = $("status");
  if (el) { el.textContent = text; el.className = `status ${type}`; }
}
function voiceStatus(text, type = "") {
  const el = $("voiceStatus");
  if (el) { el.textContent = text; el.className = `status ${type}`; }
}
function mb(n) { return `${(n / 1e6).toFixed(1)} MB`; }
function key() { return $("deepgramKey")?.value.trim() || localStorage.getItem("voicechanger.deepgramKey") || ""; }

async function refreshOutputs() {
  const select = $("outputDevice");
  if (!select || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    const current = localStorage.getItem("voicechanger.outputDevice") || "default";
    select.replaceChildren();
    select.add(new Option("Windows default output", "default"));
    for (const d of outputs) {
      if (d.deviceId === "default") continue;
      select.add(new Option(d.label || `Audio output ${d.deviceId.slice(0, 8)}`, d.deviceId));
    }
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  } catch (e) { log(`OUTPUT ERROR: ${e.message}`); }
}

function stopPlayback() {
  if (playbackAudio) {
    try { playbackAudio.pause(); playbackAudio.removeAttribute("src"); playbackAudio.load(); } catch {}
    playbackAudio = null;
  }
  if (playbackUrl) { URL.revokeObjectURL(playbackUrl); playbackUrl = null; }
}

async function playWav(blob) {
  if (!blob) throw new Error("No audio was generated.");
  stopPlayback();
  const audio = new Audio(URL.createObjectURL(blob));
  playbackAudio = audio;
  playbackUrl = audio.src;
  const device = $("outputDevice")?.value || "default";
  if (device !== "default" && typeof audio.setSinkId === "function") await audio.setSinkId(device);
  audio.onended = () => { if (playbackUrl) URL.revokeObjectURL(playbackUrl); playbackUrl = null; playbackAudio = null; };
  await audio.play();
}

async function loadModel() {
  const button = $("loadModel");
  if (!button) return;
  button.disabled = true;
  button.textContent = "Loading…";
  $("progressBar").style.width = "2%";
  const errors = [];

  for (let i = 0; i < MODEL_SOURCES.length; i++) {
    const base = MODEL_SOURCES[i];
    try {
      status(`Downloading Pocket TTS bundle ${i + 1}/${MODEL_SOURCES.length}…`, "working");
      log(`Trying Pocket TTS v2 bundle: ${base}`);
      tts?.destroy?.();
      const candidate = new PocketTTS({
        language: "english_2026-04",
        quantized: true,
        voiceCloning: true,
        cache: true,
        cacheName: "voicechanger-pocket-tts-v4",
        maxThreads: Math.min(4, navigator.hardwareConcurrency || 2),
        modelBaseUrl: base,
        ortBaseUrl: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/"
      });
      const info = await candidate.load((p) => {
        if (p?.total) {
          const pct = Math.max(1, Math.min(100, Math.round((p.loaded / p.total) * 100)));
          $("progressBar").style.width = `${pct}%`;
          if (pct % 10 === 0 || pct === 100) log(`${p.label || "model"}: ${pct}% (${mb(p.total)})`);
        } else if (p?.status) log(`Model: ${p.status}`);
      });
      tts = candidate;
      $("modelInfo").textContent = `Ready • ${tts.sampleRate} Hz • INT8 • ${(info.predefinedVoices || []).length} voices`;
      $("modelBadge").textContent = "AI ready";
      $("modelBadge").style.color = "#83e1aa";
      $("cloneFile").disabled = false;
      $("recordVoice").disabled = false;
      $("progressBar").style.width = "100%";
      status("Pocket TTS ready. Record or upload a voice sample.", "ok");
      button.disabled = false;
      button.textContent = "Reload Pocket TTS";
      await refreshOutputs();
      log("Pocket TTS loaded successfully.");
      return;
    } catch (e) {
      const message = e?.stack || e?.message || String(e);
      errors.push(`${base}: ${message}`);
      log(`MODEL SOURCE FAILED: ${message}`);
    }
  }

  status("Pocket TTS failed to load. See Activity for the exact error.", "bad");
  log(`MODEL ERROR: ${errors.join(" | ")}`);
  button.disabled = false;
  button.textContent = "Retry Pocket TTS";
}

async function cloneAudio(blob, name) {
  if (!tts) throw new Error("Load Pocket TTS first.");
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buffer.duration < 2) throw new Error("Use at least 2 seconds of speech.");
    if (buffer.duration > 30) throw new Error("Keep the sample under 30 seconds.");
    const mono = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      let sum = 0;
      for (let c = 0; c < buffer.numberOfChannels; c++) sum += buffer.getChannelData(c)[i] || 0;
      mono[i] = sum / buffer.numberOfChannels;
    }
    voiceRef = await tts.cloneVoice(mono, { inputSampleRate: buffer.sampleRate, name: `clone:${name}:${Date.now()}` });
  } finally { await ctx.close(); }
  voiceStatus(`✓ Voice cloned: ${name}`, "ok");
  $("generate").disabled = false;
  if (key()) $("startVC").disabled = false;
  log(`Voice clone created from ${name}.`);
}

async function cloneFile(file) {
  $("cloneFile").disabled = true;
  voiceStatus("Analyzing voice sample…", "working");
  try { await cloneAudio(file, file.name); }
  catch (e) { voiceStatus(`Clone failed: ${e.message}`, "bad"); log(`CLONE ERROR: ${e.stack || e.message}`); }
  finally { $("cloneFile").disabled = false; }
}

async function recordClone() {
  if (!tts) { voiceStatus("Load Pocket TTS first.", "bad"); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      $("recordVoice").disabled = false;
      $("stopRecord").disabled = true;
      try { await cloneAudio(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), "microphone recording"); }
      catch (e) { voiceStatus(`Clone failed: ${e.message}`, "bad"); log(`MIC CLONE ERROR: ${e.stack || e.message}`); }
    };
    recorder.start();
    $("recordVoice").disabled = true;
    $("stopRecord").disabled = false;
    voiceStatus("🔴 Recording… speak clearly for 3–15 seconds.", "working");
    $("stopRecord").onclick = () => recorder.state !== "inactive" && recorder.stop();
  } catch (e) { voiceStatus(`Microphone failed: ${e.message}`, "bad"); }
}

async function speak(text, mode = "manual") {
  if (!tts) { status("Load Pocket TTS first.", "bad"); return; }
  if (!voiceRef) { status("Clone a voice first.", "bad"); return; }
  if (!text.trim() || generating) return;
  generating = true;
  try {
    status(mode === "echo" ? "Echoing with cloned voice…" : "Generating cloned speech…", "working");
    const chunks = [];
    const metrics = await tts.generate(text.trim().slice(0, 1500), {
      voice: voiceRef,
      onChunk: (audio) => chunks.push(audio.slice())
    });
    if (!chunks.length) throw new Error("No audio was generated.");
    const blob = chunksToWavBlob(chunks, tts.sampleRate);
    if (mode === "manual") {
      const url = URL.createObjectURL(blob);
      $("preview").src = url;
      $("preview").hidden = false;
      $("download").href = url;
      $("download").download = `voicechanger-${Date.now()}.wav`;
      $("download").classList.remove("hidden");
    }
    await playWav(blob);
    status(`Spoken • ${metrics.audioDuration.toFixed(2)}s`, "ok");
  } catch (e) {
    status(`TTS failed: ${e.message}`, "bad");
    log(`TTS ERROR: ${e.stack || e.message}`);
  } finally { generating = false; }
}

function downsample(data, from, to = 16000) {
  if (from === to) return data;
  const ratio = from / to;
  const out = new Float32Array(Math.round(data.length / ratio));
  let offset = 0;
  for (let i = 0; i < out.length; i++) {
    const end = Math.min(data.length, Math.round((i + 1) * ratio));
    let sum = 0, count = 0;
    for (; offset < end; offset++) { sum += data[offset]; count++; }
    out[i] = count ? sum / count : 0;
  }
  return out;
}
function pcm16(data) {
  const out = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) { const s = Math.max(-1, Math.min(1, data[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  return out;
}

function stopVC() {
  if (processor) { try { processor.disconnect(); } catch {} processor = null; }
  if (sourceNode) { try { sourceNode.disconnect(); } catch {} sourceNode = null; }
  if (audioContext) { try { audioContext.close(); } catch {} audioContext = null; }
  if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
  if (sttSocket) { try { sttSocket.close(); } catch {} sttSocket = null; }
  sttRunning = false;
  $("micDot").classList.remove("live");
  $("startVC").disabled = false;
  $("stopVC").disabled = true;
  $("sttInfo").textContent = "VoiceChanger stopped.";
}

async function startVC() {
  if (!key()) throw new Error("Enter your Deepgram API key first.");
  if (!voiceRef) throw new Error("Clone a voice first.");
  stopVC();
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  sttSocket = new WebSocket("wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&endpointing=300", ["token", key()]);
  sttSocket.binaryType = "arraybuffer";
  sttSocket.onopen = () => {
    audioContext = new AudioContext();
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silent = audioContext.createGain(); silent.gain.value = 0;
    sourceNode.connect(processor); processor.connect(silent); silent.connect(audioContext.destination);
    processor.onaudioprocess = (e) => {
      if (!sttRunning || sttSocket.readyState !== WebSocket.OPEN) return;
      sttSocket.send(pcm16(downsample(e.inputBuffer.getChannelData(0), audioContext.sampleRate)).buffer);
    };
    sttRunning = true;
    $("micDot").classList.add("live");
    $("startVC").disabled = true;
    $("stopVC").disabled = false;
    $("sttInfo").textContent = "Deepgram listening — speak normally.";
    status("STT listening…", "ok");
    log("Deepgram connected.");
  };
  sttSocket.onmessage = (e) => {
    let data; try { data = JSON.parse(e.data); } catch { return; }
    if (data.type !== "Results") return;
    const text = data.channel?.alternatives?.[0]?.transcript?.trim();
    if (!text) return;
    $("transcript").textContent = text;
    if (data.is_final) echoQueue = echoQueue.then(() => speak(text, "echo")).catch((err) => log(`ECHO ERROR: ${err.message}`));
  };
  sttSocket.onerror = () => log("Deepgram WebSocket error.");
  sttSocket.onclose = () => { if (sttRunning) stopVC(); };
}

$("deepgramKey").value = localStorage.getItem("voicechanger.deepgramKey") || "";
$("deepgramKey").addEventListener("input", () => {
  localStorage.setItem("voicechanger.deepgramKey", $("deepgramKey").value.trim());
  if (voiceRef) $("startVC").disabled = !key();
});
$("loadModel").addEventListener("click", loadModel);
$("cloneFile").addEventListener("change", (e) => e.target.files?.[0] && cloneFile(e.target.files[0]));
$("recordVoice").addEventListener("click", recordClone);
$("generate").addEventListener("click", () => speak($("text").value));
$("stop").addEventListener("click", () => { tts?.stop?.(); stopPlayback(); });
$("refreshOutputs").addEventListener("click", refreshOutputs);
$("outputDevice").addEventListener("change", () => localStorage.setItem("voicechanger.outputDevice", $("outputDevice").value));
$("startVC").addEventListener("click", () => startVC().catch((e) => { status(`VoiceChanger failed: ${e.message}`, "bad"); log(`VC ERROR: ${e.stack || e.message}`); }));
$("stopVC").addEventListener("click", stopVC);
refreshOutputs();
