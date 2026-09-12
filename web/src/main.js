import { PocketTTS, chunksToWavBlob } from "pocket-tts-js";

const $ = (id) => document.getElementById(id);
let tts = null;
let voiceRef = null;
let recognition = null;
let listening = false;
let generating = false;
let recording = false;
let mediaRecorder = null;
let recordChunks = [];
let wavUrl = null;
let currentAudio = null;
let echoQueue = Promise.resolve();
let echoCounter = 0;

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
function supportsSTT() { return "SpeechRecognition" in window || "webkitSpeechRecognition" in window; }
function mb(n) { return `${(n / 1e6).toFixed(1)} MB`; }

async function refreshOutputs() {
  const select = $("outputDevice");
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    const current = select.value;
    select.replaceChildren();
    if (!outputs.length) {
      select.add(new Option("System default output", "default"));
      return;
    }
    for (const device of outputs) {
      const label = device.label || (device.deviceId === "default" ? "Default Windows output" : `Audio output ${device.deviceId.slice(0, 8)}`);
      select.add(new Option(label, device.deviceId));
    }
    if ([...select.options].some((o) => o.value === current)) select.value = current;
    log(`Found ${outputs.length} Windows audio output device${outputs.length === 1 ? "" : "s"}.`);
  } catch (error) { log(`OUTPUT ERROR: ${error.message}`); }
}

async function chooseOutput(audio) {
  const sinkId = $("outputDevice").value || "default";
  if (typeof audio.setSinkId === "function") {
    try {
      await audio.setSinkId(sinkId);
      return;
    } catch (error) {
      log(`Selected output unavailable (${error.message}); using Windows default.`);
      try { await audio.setSinkId("default"); } catch {}
    }
  }
}

async function stopAudio() {
  if (!currentAudio) return;
  try { currentAudio.pause(); currentAudio.currentTime = 0; currentAudio.removeAttribute("src"); currentAudio.load(); } catch {}
  currentAudio = null;
}

async function playBlob(blob) {
  await stopAudio();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = "auto";
  currentAudio = audio;
  await chooseOutput(audio);
  audio.onended = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; };
  audio.onerror = () => log("AUDIO ERROR: generated speech could not be played.");
  try {
    await audio.play();
  } catch (error) {
    log(`PLAYBACK ERROR: ${error.message}`);
    await chooseOutput(audio);
    await audio.play();
  }
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
      tts = null;
      voiceRef = null;
      const candidate = new PocketTTS({
        language: "english_2026-04",
        quantized: true,
        voiceCloning: true,
        cache: true,
        cacheName: "voicechanger-pocket-tts-v2",
        maxThreads: Math.min(4, navigator.hardwareConcurrency || 2),
        modelBaseUrl: source,
        ortBaseUrl: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/"
      });
      const seen = new Map();
      const bundle = await candidate.load((info) => {
        if (info.type === "progress" && info.total) {
          const pct = Math.round((info.loaded / info.total) * 100);
          $("progressBar").style.width = `${pct}%`;
          const key = info.label || "model";
          if ((pct % 10 === 0 || pct === 100) && seen.get(key) !== pct) {
            seen.set(key, pct);
            log(`${key}: ${pct}% (${mb(info.total)})${info.fromCache ? " cached" : ""}`);
          }
        } else if (info.status) log(`Model: ${info.status}`);
      });
      tts = candidate;
      $("modelInfo").textContent = `Ready • ${tts.sampleRate} Hz • INT8 • ${bundle.predefinedVoices.length} bundled voices available`;
      $("modelBadge").textContent = "AI ready";
      $("modelBadge").style.color = "#83e1aa";
      $("cloneFile").disabled = false;
      $("recordVoice").disabled = false;
      $("progressBar").style.width = "100%";
      setStatus("Pocket TTS ready. Record or import a voice sample.", "ok");
      if (supportsSTT()) setupSTT();
      await refreshOutputs();
      log(`Pocket TTS is ready using source ${i + 1}.`);
      button.disabled = false;
      button.textContent = "Reload Pocket TTS";
      return;
    } catch (error) {
      const message = error?.message || String(error);
      errors.push(`${source}: ${message}`);
      log(`MODEL SOURCE FAILED: ${message}`);
      if (/429/.test(message)) log("HTTP 429 rate limit detected; switching to the next model source.");
    }
  }

  tts = null;
  setStatus("Model failed: all download sources were unavailable.", "bad");
  log(`MODEL ERROR: ${errors.join(" | ")}`);
  button.disabled = false;
  button.textContent = "Retry Pocket TTS";
}

async function decodeAndClone(blob, name = "recording.webm") {
  if (!tts) throw new Error("Load Pocket TTS first.");
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buffer.duration < 2) throw new Error("Use at least 2 seconds of speech for cloning.");
    if (buffer.duration > 30) throw new Error("Keep the reference clip under 30 seconds.");
    const mono = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      let sum = 0;
      for (let c = 0; c < buffer.numberOfChannels; c += 1) sum += buffer.getChannelData(c)[i] || 0;
      mono[i] = sum / buffer.numberOfChannels;
    }
    voiceRef = await tts.cloneVoice(mono, { inputSampleRate: buffer.sampleRate, name: `clone:${name}:${Date.now()}` });
  } finally { await ctx.close(); }
  setVoiceStatus(`✓ Voice cloned: ${name}`, "ok");
  $("generate").disabled = false;
  $("startVC").disabled = !supportsSTT();
  log(`Voice clone created from ${name}.`);
}
async function cloneFile(file) {
  if (!tts) return;
  $("cloneFile").disabled = true;
  setVoiceStatus("Analyzing voice sample…", "working");
  try { await decodeAndClone(file, file.name); }
  catch (error) { setVoiceStatus(`Clone failed: ${error.message}`, "bad"); log(`CLONE ERROR: ${error.stack || error.message}`); }
  finally { $("cloneFile").disabled = false; }
}
async function startRecording() {
  if (!tts || recording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    mediaRecorder = new MediaRecorder(stream);
    recordChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recordChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      recording = false;
      $("recordVoice").disabled = false;
      $("stopRecord").disabled = true;
      if (!recordChunks.length) return;
      const blob = new Blob(recordChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      setVoiceStatus("Processing recording…", "working");
      try { await decodeAndClone(blob, "mic recording"); }
      catch (error) { setVoiceStatus(`Clone failed: ${error.message}`, "bad"); log(`MIC CLONE ERROR: ${error.stack || error.message}`); }
    };
    mediaRecorder.start();
    recording = true;
    $("recordVoice").disabled = true;
    $("stopRecord").disabled = false;
    setVoiceStatus("🔴 Recording… speak clearly for 3–15 seconds.", "working");
    log("Voice-clone microphone recording started.");
  } catch (error) { setVoiceStatus(`Microphone failed: ${error.message}`, "bad"); log(`MIC ERROR: ${error.stack || error.message}`); }
}
function stopRecording() { if (mediaRecorder && recording) mediaRecorder.stop(); }

async function generate(text, mode = "manual") {
  if (!tts || !voiceRef || !text.trim() || generating) return;
  generating = true;
  if (mode === "manual") {
    $("generate").disabled = true;
    $("stop").disabled = false;
  }
  $("preview").hidden = true;
  $("download").classList.add("hidden");
  const chunks = [];
  try {
    await stopAudio();
    const cleanText = text.trim().slice(0, 1500);
    setStatus(mode === "echo" ? "Echoing with your cloned voice…" : "Generating cloned speech…", "working");
    log(`${mode === "echo" ? "ECHO" : "TTS"}: ${cleanText.slice(0, 100)}${cleanText.length > 100 ? "…" : ""}`);
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
    await playBlob(blob);
    setStatus(mode === "echo" ? `Echoed • ${metrics.audioDuration.toFixed(2)}s` : `Spoken • ${metrics.audioDuration.toFixed(2)}s • routed to selected output`, "ok");
    log(`Generated ${metrics.audioDuration.toFixed(2)} seconds of cloned audio.`);
  } catch (error) {
    if (!/stop/i.test(error?.message || "")) { setStatus(`${mode === "echo" ? "Echo" : "TTS"} failed: ${error?.message || error}`, "bad"); log(`${mode === "echo" ? "ECHO" : "TTS"} ERROR: ${error?.stack || error}`); }
  } finally {
    generating = false;
    if (mode === "manual") {
      $("generate").disabled = !voiceRef;
      $("stop").disabled = true;
    }
  }
}

function setupSTT() {
  if (recognition) return;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    $("sttInfo").textContent = "This Electron build does not provide browser SpeechRecognition.";
    return;
  }
  recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    listening = true;
    $("startVC").disabled = true;
    $("stopVC").disabled = false;
    $("micDot").classList.add("live");
    $("sttInfo").textContent = "Listening — each phrase will echo in your cloned voice.";
    setStatus("VoiceChanger listening…", "ok");
    log("Continuous echo listening started.");
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result.isFinal) continue;
      const text = result[0].transcript.trim();
      if (!text || !voiceRef || !listening) continue;
      log(`You said: ${text}`);
      echoCounter += 1;
      const id = echoCounter;
      echoQueue = echoQueue.then(async () => {
        if (!listening || id !== echoCounter) return;
        await generate(text, "echo");
      }).catch((error) => log(`ECHO QUEUE ERROR: ${error.message}`));
    }
  };

  recognition.onerror = (event) => {
    log(`STT: ${event.error}`);
    if (event.error === "not-allowed" || event.error === "service-not-allowed") stopVoiceChanger();
  };

  recognition.onend = () => {
    if (listening) {
      setTimeout(() => {
        if (!listening) return;
        try { recognition.start(); } catch {}
      }, 100);
    }
  };
}

function startVoiceChanger() {
  if (!voiceRef) return;
  if (!recognition) setupSTT();
  if (!recognition) return;
  listening = true;
  echoCounter += 1;
  try { recognition.start(); } catch {}
}

function stopVoiceChanger() {
  listening = false;
  echoCounter += 1;
  try { recognition?.stop(); } catch {}
  $("micDot").classList.remove("live");
  $("startVC").disabled = !voiceRef;
  $("stopVC").disabled = true;
  $("sttInfo").textContent = "VoiceChanger stopped.";
  if (!generating) setStatus("VoiceChanger stopped.");
  log("Continuous echo stopped.");
}

$("loadModel").addEventListener("click", loadModel);
$("cloneFile").addEventListener("change", (e) => { const file = e.target.files?.[0]; if (file) cloneFile(file); });
$("recordVoice").addEventListener("click", startRecording);
$("stopRecord").addEventListener("click", stopRecording);
$("generate").addEventListener("click", () => generate($("text").value));
$("stop").addEventListener("click", async () => {
  try { await tts?.stop(); } catch {}
  await stopAudio();
  $("stop").disabled = true;
  $("generate").disabled = !voiceRef;
  setStatus("Generation stopped.");
  log("TTS generation stopped.");
});
$("startVC").addEventListener("click", startVoiceChanger);
$("stopVC").addEventListener("click", stopVoiceChanger);
$("refreshOutputs").addEventListener("click", refreshOutputs);
$("outputDevice").addEventListener("change", () => log(`Output selected: ${$("outputDevice").selectedOptions[0]?.textContent || "default"}`));

if (supportsSTT()) $("sttInfo").textContent = "STT available — load the model and clone a voice to begin.";
else $("sttInfo").textContent = "SpeechRecognition is unavailable in this Electron build.";
refreshOutputs();
log("Desktop VoiceChanger ready. Each finalized phrase now echoes through the cloned voice.");
