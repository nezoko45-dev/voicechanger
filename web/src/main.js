import { PocketTTS, chunksToWavBlob } from "pocket-tts-js";

const $ = (id) => document.getElementById(id);
let tts = null;
let voiceRef = null;
let wavUrl = null;
let generating = false;
let mediaStream = null;
let audioContext = null;
let processor = null;
let sourceNode = null;
let sttSocket = null;
let sttRunning = false;
let echoQueue = Promise.resolve();
let sessionId = 0;
let playbackAudio = null;
let playbackUrl = null;

const MODEL_SOURCES = [
  "https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/main/onnx",
  "https://hf-mirror.com/KevinAHM/pocket-tts-onnx/resolve/main/onnx",
  "https://huggingface.co/vlapky/pocket-tts-onnx/resolve/main/onnx"
];

function log(message) {
  const box = $("log");
  box.textContent = `${new Date().toLocaleTimeString()} — ${message}\n${box.textContent}`;
}
function setStatus(text, type = "") {
  $("status").textContent = text;
  $("status").className = `status ${type}`;
}
function setVoiceStatus(text, type = "") {
  $("voiceStatus").textContent = text;
  $("voiceStatus").className = `status ${type}`;
}
function mb(n) { return `${(n / 1e6).toFixed(1)} MB`; }
function getApiKey() { return $("deepgramKey")?.value.trim() || localStorage.getItem("voicechanger.deepgramKey") || ""; }
function setTranscript(text, interim = false) {
  const box = $("transcript");
  if (!box) return;
  box.textContent = text || (interim ? "Listening…" : "Nothing transcribed yet.");
  box.dataset.interim = interim ? "true" : "false";
}
function addTranscript(text) {
  const box = $("transcript");
  if (!box || !text) return;
  const existing = box.textContent === "Nothing transcribed yet." || box.dataset.interim === "true" ? "" : box.textContent;
  box.textContent = `${existing}${existing ? " " : ""}${text}`.trim();
  box.dataset.interim = "false";
}

async function refreshOutputs() {
  const select = $("outputDevice");
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    const current = select.value || localStorage.getItem("voicechanger.outputDevice") || "";
    select.replaceChildren();
    if (!outputs.length) select.add(new Option("Windows default output", "default"));
    for (const device of outputs) {
      const label = device.label || (device.deviceId === "default" ? "Windows default output" : `Audio output ${device.deviceId.slice(0, 8)}`);
      select.add(new Option(label, device.deviceId));
    }
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  } catch (error) { log(`OUTPUT ERROR: ${error.message}`); }
}

function stopBrowserPlayback() {
  if (playbackAudio) {
    try { playbackAudio.pause(); } catch {}
    try { playbackAudio.removeAttribute("src"); playbackAudio.load(); } catch {}
    playbackAudio = null;
  }
  if (playbackUrl) {
    URL.revokeObjectURL(playbackUrl);
    playbackUrl = null;
  }
}

async function playWavInBrowser(blob) {
  if (!blob) throw new Error("No audio was generated.");
  if (typeof HTMLMediaElement.prototype.setSinkId !== "function") {
    throw new Error("This browser does not support selecting an audio output device. Use current Chrome or Edge.");
  }

  const select = $("outputDevice");
  const selectedDevice = select?.value || localStorage.getItem("voicechanger.outputDevice") || "default";
  stopBrowserPlayback();

  const audio = new Audio();
  const url = URL.createObjectURL(blob);
  playbackAudio = audio;
  playbackUrl = url;
  audio.preload = "auto";
  audio.src = url;

  if (selectedDevice && selectedDevice !== "default") {
    await audio.setSinkId(selectedDevice);
  }

  audio.onended = () => {
    if (playbackAudio === audio) playbackAudio = null;
    if (playbackUrl === url) {
      URL.revokeObjectURL(url);
      playbackUrl = null;
    }
  };

  await audio.play();
  return true;
}

async function loadModel() {
  const button = $("loadModel");
  button.disabled = true;
  button.textContent = "Loading…";
  $("progressBar").style.width = "2%";
  const errors = [];
  for (let i = 0; i < MODEL_SOURCES.length; i += 1) {
    const source = MODEL_SOURCES[i];
    setStatus(`Downloading Pocket TTS… source ${i + 1}/${MODEL_SOURCES.length}`, "working");
    log(`Trying model source: ${source}`);
    try {
      tts?.destroy();
      const candidate = new PocketTTS({
        language: "english_2026-04",
        quantized: true,
        voiceCloning: true,
        cache: true,
        cacheName: "voicechanger-pocket-tts-v3",
        maxThreads: Math.min(4, navigator.hardwareConcurrency || 2),
        modelBaseUrl: source,
        ortBaseUrl: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/"
      });
      const bundle = await candidate.load((info) => {
        if (info.type === "progress" && info.total) {
          const pct = Math.round((info.loaded / info.total) * 100);
          $("progressBar").style.width = `${pct}%`;
          if (pct % 10 === 0 || pct === 100) log(`${info.label || "model"}: ${pct}% (${mb(info.total)})`);
        } else if (info.status) log(`Model: ${info.status}`);
      });
      tts = candidate;
      $("modelInfo").textContent = `Ready • ${tts.sampleRate} Hz • INT8 • ${bundle.predefinedVoices.length} voices`;
      $("modelBadge").textContent = "AI ready";
      $("modelBadge").style.color = "#83e1aa";
      $("cloneFile").disabled = false;
      $("recordVoice").disabled = false;
      $("generate").disabled = !voiceRef;
      $("progressBar").style.width = "100%";
      setStatus("Pocket TTS ready. Clone a voice, then test it below.", "ok");
      await refreshOutputs();
      log(`Pocket TTS ready from source ${i + 1}.`);
      button.disabled = false;
      button.textContent = "Reload Pocket TTS";
      return;
    } catch (error) {
      errors.push(`${source}: ${error?.message || error}`);
      log(`MODEL SOURCE FAILED: ${error?.message || error}`);
    }
  }
  setStatus("Model failed: all download sources were unavailable.", "bad");
  log(`MODEL ERROR: ${errors.join(" | ")}`);
  button.disabled = false;
  button.textContent = "Retry Pocket TTS";
}

async function decodeAndClone(blob, name) {
  if (!tts) throw new Error("Load Pocket TTS first.");
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buffer.duration < 2) throw new Error("Use at least 2 seconds of speech.");
    if (buffer.duration > 30) throw new Error("Keep the clone sample under 30 seconds.");
    const mono = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i += 1) {
      let sum = 0;
      for (let c = 0; c < buffer.numberOfChannels; c += 1) sum += buffer.getChannelData(c)[i] || 0;
      mono[i] = sum / buffer.numberOfChannels;
    }
    voiceRef = await tts.cloneVoice(mono, { inputSampleRate: buffer.sampleRate, name: `clone:${name}:${Date.now()}` });
  } finally { await ctx.close(); }
  setVoiceStatus(`✓ Voice cloned: ${name}`, "ok");
  $("generate").disabled = false;
  $("startVC").disabled = !getApiKey();
  log(`Voice clone created from ${name}.`);
}

async function cloneFile(file) {
  $("cloneFile").disabled = true;
  setVoiceStatus("Analyzing voice sample…", "working");
  try { await decodeAndClone(file, file.name); }
  catch (error) { setVoiceStatus(`Clone failed: ${error.message}`, "bad"); log(`CLONE ERROR: ${error.stack || error.message}`); }
  finally { $("cloneFile").disabled = false; }
}

async function startRecording() {
  if (!tts) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      $("recordVoice").disabled = false;
      $("stopRecord").disabled = true;
      try { await decodeAndClone(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), "mic recording"); }
      catch (error) { setVoiceStatus(`Clone failed: ${error.message}`, "bad"); log(`MIC CLONE ERROR: ${error.stack || error.message}`); }
    };
    recorder.start();
    $("recordVoice").disabled = true;
    $("stopRecord").disabled = false;
    setVoiceStatus("🔴 Recording… speak clearly for 3–15 seconds.", "working");
    $("stopRecord").onclick = () => { if (recorder.state !== "inactive") recorder.stop(); };
  } catch (error) { setVoiceStatus(`Microphone failed: ${error.message}`, "bad"); }
}

async function generate(text, mode = "manual") {
  if (!tts || !voiceRef || !text.trim() || generating) return;
  generating = true;
  const chunks = [];
  try {
    const cleanText = text.trim().slice(0, 1500);
    setStatus(mode === "echo" ? "Echoing with cloned voice…" : "Generating cloned speech…", "working");
    log(`${mode === "echo" ? "ECHO" : "TTS"}: ${cleanText}`);
    const metrics = await tts.generate(cleanText, { voice: voiceRef, onChunk: (audio) => chunks.push(audio.slice()) });
    if (!chunks.length) throw new Error("No audio was generated.");
    const blob = chunksToWavBlob(chunks, tts.sampleRate);
    if (mode === "manual") {
      if (wavUrl) URL.revokeObjectURL(wavUrl);
      wavUrl = URL.createObjectURL(blob);
      $("preview").src = wavUrl;
      $("preview").hidden = false;
      $("download").href = wavUrl;
      $("download").download = `voicechanger-${Date.now()}.wav`;
      $("download").classList.remove("hidden");
    }
    await playWavInBrowser(blob);
    setStatus(`Spoken • ${metrics.audioDuration.toFixed(2)}s`, "ok");
  } catch (error) {
    setStatus(`${mode === "echo" ? "Echo" : "TTS"} failed: ${error.message}`, "bad");
    log(`AUDIO/TTS ERROR: ${error.stack || error}`);
  } finally { generating = false; }
}

function downsampleFloat32(buffer, inputRate, targetRate = 16000) {
  if (inputRate === targetRate) return buffer;
  const ratio = inputRate / targetRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offset = 0;
  for (let i = 0; i < newLength; i += 1) {
    const next = Math.min(buffer.length, Math.round((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (; offset < next; offset += 1) { sum += buffer[offset]; count += 1; }
    result[i] = count ? sum / count : 0;
  }
  return result;
}
function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function stopDeepgram() {
  sttRunning = false;
  if (processor) { try { processor.disconnect(); } catch {} processor.onaudioprocess = null; processor = null; }
  if (sourceNode) { try { sourceNode.disconnect(); } catch {} sourceNode = null; }
  if (audioContext) { try { audioContext.close(); } catch {} audioContext = null; }
  if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
  if (sttSocket) { try { sttSocket.close(); } catch {} sttSocket = null; }
}

async function startDeepgram() {
  const key = getApiKey();
  if (!key) throw new Error("Enter your Deepgram API key first.");
  if (!voiceRef) throw new Error("Clone a voice first.");
  stopDeepgram();
  setTranscript("Connecting to Deepgram…", true);
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const url = "wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&endpointing=300&utterance_end_ms=1000";
  sttSocket = new WebSocket(url, ["token", key]);
  const id = ++sessionId;
  sttSocket.binaryType = "arraybuffer";

  sttSocket.onopen = async () => {
    if (id !== sessionId) return;
    audioContext = new AudioContext();
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silent = audioContext.createGain();
    silent.gain.value = 0;
    sourceNode.connect(processor);
    processor.connect(silent);
    silent.connect(audioContext.destination);
    processor.onaudioprocess = (event) => {
      if (!sttRunning || !sttSocket || sttSocket.readyState !== WebSocket.OPEN) return;
      const mono = event.inputBuffer.getChannelData(0);
      const pcm = floatTo16BitPCM(downsampleFloat32(mono, audioContext.sampleRate, 16000));
      sttSocket.send(pcm.buffer);
    };
    sttRunning = true;
    $("micDot").classList.add("live");
    $("startVC").disabled = true;
    $("stopVC").disabled = false;
    $("sttInfo").textContent = "Deepgram listening — speak normally.";
    setStatus("STT listening…", "ok");
    setTranscript("Listening…", true);
    log("Deepgram streaming STT connected.");
  };

  sttSocket.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.type !== "Results") return;
    const alt = data.channel?.alternatives?.[0];
    const text = alt?.transcript?.trim() || "";
    if (!text) return;
    setTranscript(text, !data.is_final);
    if (!data.is_final || !sttRunning) return;
    addTranscript("");
    log(`YOU: ${text}`);
    const thisSession = id;
    echoQueue = echoQueue.then(async () => {
      if (!sttRunning || thisSession !== sessionId) return;
      await generate(text, "echo");
    }).catch((error) => log(`ECHO ERROR: ${error.message}`));
  };
  sttSocket.onerror = () => {
    setStatus("Deepgram STT connection failed.", "bad");
    log("DEEPGRAM ERROR: check your API key and internet connection.");
    stopDeepgram();
    $("micDot").classList.remove("live");
    $("startVC").disabled = false;
    $("stopVC").disabled = true;
  };
  sttSocket.onclose = () => {
    if (!sttRunning) return;
    stopDeepgram();
    $("micDot").classList.remove("live");
    $("startVC").disabled = false;
    $("stopVC").disabled = true;
    log("Deepgram STT disconnected.");
  };
}

$("loadModel").addEventListener("click", loadModel);
$("cloneFile").addEventListener("change", (e) => { const file = e.target.files?.[0]; if (file) cloneFile(file); });
$("recordVoice").addEventListener("click", startRecording);
$("generate").addEventListener("click", () => generate($("text").value));
$("stop").addEventListener("click", async () => { try { await tts?.stop(); } catch {} stopBrowserPlayback(); setStatus("Generation stopped."); });
$("startVC").addEventListener("click", () => startDeepgram().catch((error) => { setStatus(`STT failed: ${error.message}`, "bad"); log(`STT ERROR: ${error.message}`); }));
$("stopVC").addEventListener("click", () => { stopDeepgram(); setStatus("VoiceChanger stopped."); });
$("refreshOutputs").addEventListener("click", refreshOutputs);
$("deepgramKey").addEventListener("change", () => { localStorage.setItem("voicechanger.deepgramKey", $("deepgramKey").value.trim()); $("startVC").disabled = !voiceRef || !getApiKey(); });

const savedKey = localStorage.getItem("voicechanger.deepgramKey");
if (savedKey && $("deepgramKey")) $("deepgramKey").value = savedKey;
setTranscript("Nothing transcribed yet.");
refreshOutputs();
log("VoiceChanger browser app ready. Deepgram STT + local Pocket TTS + browser audio output are active.");