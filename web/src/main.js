import { PocketTTS, StreamingPlayer, chunksToWavBlob } from "pocket-tts-js";

const $ = (id) => document.getElementById(id);
let tts = null;
let player = null;
let voiceRef = null;
let recognition = null;
let listening = false;
let generating = false;
let voiceChunks = [];
let wavUrl = null;

function log(message) {
  const box = $("log");
  box.textContent = `${new Date().toLocaleTimeString()} — ${message}\n${box.textContent}`;
}
function status(text, type = "") { $("status").textContent = text; $("status").className = `status ${type}`; }
function voiceStatus(text, type = "") { $("voiceStatus").textContent = text; $("voiceStatus").className = `status ${type}`; }
function supportsSTT() { return "SpeechRecognition" in window || "webkitSpeechRecognition" in window; }
function setProgress(value) { $("progressBar").style.width = `${Math.max(0, Math.min(100, value))}%`; }
function mb(n) { return `${(n / 1e6).toFixed(1)} MB`; }

async function loadModel() {
  const button = $("loadModel");
  button.disabled = true;
  button.textContent = "Loading…";
  status("Downloading Pocket TTS…", "working");
  setProgress(2);
  log("Loading Pocket TTS in a browser worker.");
  try {
    tts?.destroy();
    tts = new PocketTTS({
      language: "english_2026-04",
      quantized: true,
      voiceCloning: true,
      cache: true,
      maxThreads: 8,
    });
    const seen = new Map();
    const bundle = await tts.load((info) => {
      if (info.type === "progress" && info.total) {
        const pct = Math.round(info.loaded / info.total * 100);
        setProgress(pct);
        const key = info.label || "model";
        if (pct % 10 === 0 && seen.get(key) !== pct) {
          seen.set(key, pct);
          log(`${key}: ${pct}% (${mb(info.total)})${info.fromCache ? " cached" : ""}`);
        }
      } else if (info.status) log(`Model: ${info.status}`);
    });
    player = new StreamingPlayer({
      sampleRate: tts.sampleRate,
      primeSeconds: 0.18,
      onUnderrun: (u) => log(`Audio underrun: ${Math.round(u.gapSeconds * 1000)}ms`),
    });
    $("modelInfo").textContent = `Ready • ${tts.sampleRate} Hz • INT8 • ${bundle.predefinedVoices.length} voices`;
    $("modelBadge").textContent = "AI ready";
    $("modelBadge").style.color = "#61e6a1";
    $("cloneFile").disabled = false;
    $("builtinVoice").disabled = bundle.predefinedVoices.length === 0;
    $("loadBuiltin").disabled = bundle.predefinedVoices.length === 0;
    $("builtinVoice").innerHTML = bundle.predefinedVoices.map((v) => `<option value="${v}">${v}</option>`).join("");
    setProgress(100);
    status("Pocket TTS ready — choose a voice.", "ok");
    log("Pocket TTS is ready.");
  } catch (error) {
    console.error(error);
    status(`Model failed: ${error.message}`, "bad");
    log(`MODEL ERROR: ${error.stack || error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "Reload Pocket TTS";
  }
}

async function cloneVoice(file) {
  if (!tts) return;
  $("cloneFile").disabled = true;
  voiceStatus("Analyzing your voice…", "working");
  try {
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration < 2) throw new Error("Use a recording of at least 2 seconds.");
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    const mono = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i] || 0;
      mono[i] = sum / channels.length;
    }
    voiceRef = await tts.cloneVoice(mono, { inputSampleRate: buffer.sampleRate, name: file.name });
    await ctx.close();
    voiceStatus(`✓ Your cloned voice is ready: ${file.name}`, "ok");
    $("generate").disabled = false;
    $("startVC").disabled = !supportsSTT();
    log(`Voice cloned locally from ${file.name}.`);
  } catch (error) {
    console.error(error);
    voiceStatus(`Clone failed: ${error.message}`, "bad");
    log(`CLONE ERROR: ${error.message}`);
  } finally {
    $("cloneFile").disabled = false;
  }
}

async function generate(text) {
  if (!tts || !player || !voiceRef || !text.trim() || generating) return;
  generating = true;
  $("generate").disabled = true;
  $("stop").disabled = false;
  $("download").disabled = true;
  $("preview").hidden = true;
  voiceChunks = [];
  player.reset();
  await player.resume();
  const cleanText = text.trim().slice(0, 1500);
  log(`Generating: "${cleanText.slice(0, 90)}${cleanText.length > 90 ? "…" : ""}"`);
  try {
    const metrics = await tts.generate(cleanText, {
      voice: voiceRef,
      onChunk: (audio, meta) => {
        player.play(audio, meta);
        voiceChunks.push(audio.slice());
      },
    });
    player.flush();
    if (voiceChunks.length) {
      if (wavUrl) URL.revokeObjectURL(wavUrl);
      wavUrl = URL.createObjectURL(chunksToWavBlob(voiceChunks, tts.sampleRate));
      $("download").disabled = false;
      $("preview").src = wavUrl;
      $("preview").hidden = false;
    }
    log(`Finished: ${metrics.audioDuration.toFixed(2)}s generated audio.`);
  } catch (error) {
    if (!String(error.message).toLowerCase().includes("stop")) log(`TTS ERROR: ${error.message}`);
  } finally {
    generating = false;
    $("generate").disabled = !voiceRef;
    $("stop").disabled = true;
  }
}

function setupSTT() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    $("sttInfo").textContent = "SpeechRecognition is not available in this browser.";
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
    $("sttInfo").textContent = "Microphone live — speak normally.";
    status("VoiceChanger listening…", "ok");
    log("Microphone started.");
  };
  recognition.onresult = async (event) => {
    const result = event.results[event.results.length - 1];
    if (!result.isFinal || generating) return;
    const text = result[0].transcript.trim();
    if (!text || !voiceRef) return;
    log(`You said: ${text}`);
    recognition.stop();
    await generate(text);
    if (listening) setTimeout(() => { try { recognition.start(); } catch {} }, 150);
  };
  recognition.onerror = (event) => {
    log(`Browser STT: ${event.error}`);
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      listening = false;
      $("micDot").classList.remove("live");
      status("Microphone permission was denied.", "bad");
    }
  };
  recognition.onend = () => {
    if (!listening) {
      $("micDot").classList.remove("live");
      $("startVC").disabled = !voiceRef;
      $("stopVC").disabled = true;
      return;
    }
    if (!generating) setTimeout(() => { try { recognition.start(); } catch {} }, 150);
  };
}

$("loadModel").addEventListener("click", loadModel);
$("cloneFile").addEventListener("change", (e) => { const file = e.target.files?.[0]; if (file) cloneVoice(file); });
$("loadBuiltin").addEventListener("click", async () => {
  if (!tts) return;
  const name = $("builtinVoice").value;
  voiceStatus(`Loading ${name}…`, "working");
  try {
    voiceRef = await tts.loadVoice(name);
    voiceStatus(`✓ Built-in voice: ${name}`, "ok");
    $("generate").disabled = false;
    $("startVC").disabled = !supportsSTT();
    log(`Loaded built-in voice: ${name}.`);
  } catch (error) {
    voiceStatus(`Voice failed: ${error.message}`, "bad");
    log(`VOICE ERROR: ${error.message}`);
  }
});
$("generate").addEventListener("click", () => generate($("text").value));
$("stop").addEventListener("click", async () => {
  await tts?.stop();
  player?.stop();
  $("stop").disabled = true;
  $("generate").disabled = !voiceRef;
  log("Generation stopped.");
});
$("download").addEventListener("click", () => {
  if (!wavUrl) return;
  const a = document.createElement("a");
  a.href = wavUrl;
  a.download = "pocket-voicechanger.wav";
  a.click();
});
$("startVC").addEventListener("click", async () => {
  if (!recognition || !voiceRef) return;
  listening = true;
  await player?.resume();
  try { recognition.start(); } catch {}
});
$("stopVC").addEventListener("click", () => {
  listening = false;
  recognition?.stop();
  $("micDot").classList.remove("live");
  status("VoiceChanger stopped.");
  $("startVC").disabled = !voiceRef;
  $("stopVC").disabled = true;
});
$("clearCache").addEventListener("click", async () => {
  try {
    tts?.destroy();
    tts = null;
    player = null;
    voiceRef = null;
    await PocketTTS.clearCache();
    setProgress(0);
    $("modelBadge").textContent = "AI offline";
    $("modelInfo").textContent = "Cache cleared";
    $("cloneFile").disabled = true;
    $("builtinVoice").disabled = true;
    $("loadBuiltin").disabled = true;
    $("generate").disabled = true;
    $("startVC").disabled = true;
    voiceStatus("No voice selected");
    status("Model cache cleared.", "ok");
    log("Pocket TTS cache cleared from this browser.");
  } catch (error) {
    status(`Cache clear failed: ${error.message}`, "bad");
  }
});

if (supportsSTT()) {
  setupSTT();
  $("sttInfo").textContent = "Browser speech recognition available.";
} else {
  $("sttInfo").textContent = "This browser does not expose SpeechRecognition.";
}
$("secureInfo").textContent = window.isSecureContext ? "Secure browser context ✓" : "Use the hosted HTTPS app for microphone access.";
log("Pocket VoiceChanger loaded. Load the AI to begin.");
