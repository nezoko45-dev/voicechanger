import { PocketTTS, StreamingPlayer, chunksToWavBlob } from "pocket-tts-js";

const $ = (id) => document.getElementById(id);
let tts = null;
let player = null;
let voiceRef = null;
let generating = false;
let recognition = null;
let listening = false;
let voiceChunks = [];
let wavUrl = null;

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

function browserSupportsSTT() {
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

function bytes(n) {
  return `${(n / 1e6).toFixed(1)} MB`;
}

function setProgress(value) {
  const bar = $("progressBar");
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

async function loadModel() {
  $("loadModel").disabled = true;
  $("loadModel").textContent = "Loading…";
  setStatus("Downloading browser AI…", "working");
  log("Starting Pocket TTS. The model stays in this browser.");
  setProgress(2);

  try {
    if (tts) tts.destroy();
    tts = new PocketTTS({
      language: "english_2026-04",
      quantized: true,
      voiceCloning: true,
      cache: true,
    });

    const seen = new Map();
    const bundle = await tts.load((info) => {
      if (info.type === "progress" && info.total) {
        const pct = Math.round((info.loaded / info.total) * 100);
        setProgress(pct);
        const key = info.label || "model";
        if (seen.get(key) !== pct && pct % 10 === 0) {
          seen.set(key, pct);
          log(`${key}: ${pct}% (${bytes(info.total)})${info.fromCache ? " cached" : ""}`);
        }
      } else if (info.status) log(`Model: ${info.status}`);
    });

    player = new StreamingPlayer({
      sampleRate: tts.sampleRate,
      primeSeconds: 0.18,
      onUnderrun: (u) => log(`Audio underrun: ${Math.round(u.gapSeconds * 1000)}ms`),
    });

    $("modelInfo").textContent = `Ready • ${tts.sampleRate} Hz • INT8 • ${bundle.predefinedVoices.length} built-in voices`;
    $("modelBadge").textContent = "AI ready";
    $("modelBadge").style.color = "#61e6a1";
    $("cloneFile").disabled = false;
    $("loadBuiltin").disabled = bundle.predefinedVoices.length === 0;
    $("builtinVoice").innerHTML = bundle.predefinedVoices.map((voice) => `<option value="${voice}">${voice}</option>`).join("");
    setProgress(100);
    setStatus("AI ready — choose a voice.", "ok");
    log("Browser AI is ready.");
  } catch (error) {
    console.error(error);
    setStatus(`Model failed: ${error.message}`, "bad");
    log(`MODEL ERROR: ${error.stack || error.message}`);
  } finally {
    $("loadModel").disabled = false;
    $("loadModel").textContent = "Reload Browser AI";
  }
}

async function cloneFile(file) {
  if (!tts) return;
  setVoiceStatus("Analyzing voice sample…", "working");
  $("cloneFile").disabled = true;
  try {
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration < 2) throw new Error("Use a voice sample at least 2 seconds long.");
    const mono = buffer.getChannelData(0);
    voiceRef = await tts.cloneVoice(mono, { inputSampleRate: buffer.sampleRate, name: file.name });
    await ctx.close();
    setVoiceStatus(`✓ Cloned voice: ${file.name}`, "ok");
    $("generate").disabled = false;
    $("startVC").disabled = !browserSupportsSTT();
    log(`Voice cloned locally from ${file.name}.`);
  } catch (error) {
    console.error(error);
    setVoiceStatus(`Clone failed: ${error.message}`, "bad");
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

  const cleanText = text.trim().slice(0, 1200);
  const started = performance.now();
  let firstAudio = false;
  log(`Generating voice: "${cleanText.slice(0, 80)}${cleanText.length > 80 ? "…" : ""}"`);
  try {
    const metrics = await tts.generate(cleanText, {
      voice: voiceRef,
      onChunk: (audio, meta) => {
        if (!firstAudio && !meta.isSilence) {
          firstAudio = true;
          log(`Voice audio started after ${Math.round(performance.now() - started)}ms.`);
        }
        player.play(audio, meta);
        voiceChunks.push(audio.slice());
      },
    });
    player.flush();
    if (voiceChunks.length) {
      if (wavUrl) URL.revokeObjectURL(wavUrl);
      wavUrl = URL.createObjectURL(chunksToWavBlob(voiceChunks, tts.sampleRate));
      $("download").disabled = false;
      const preview = $("preview");
      preview.src = wavUrl;
      preview.hidden = false;
    }
    log(`Finished: ${metrics.audioDuration.toFixed(2)}s of generated voice.`);
  } catch (error) {
    if (!error.message?.toLowerCase().includes("stop")) log(`TTS ERROR: ${error.message}`);
  } finally {
    generating = false;
    $("generate").disabled = !voiceRef;
    $("stop").disabled = true;
  }
}

function setupSpeechRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    $("sttInfo").textContent = "Speech recognition is unavailable in this browser.";
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
    setStatus("VoiceChanger listening…", "ok");
    log("Microphone VoiceChanger started.");
  };

  recognition.onresult = async (event) => {
    const last = event.results[event.results.length - 1];
    if (!last.isFinal) return;
    const text = last[0].transcript.trim();
    if (!text || !voiceRef || generating) return;
    log(`You said: ${text}`);
    recognition.stop();
    await generate(text);
    if (listening) {
      try { recognition.start(); } catch {}
    }
  };

  recognition.onerror = (event) => {
    log(`Microphone/STT: ${event.error}`);
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      listening = false;
      $("micDot").classList.remove("live");
      setStatus("Microphone permission was denied.", "bad");
    }
  };

  recognition.onend = () => {
    if (!listening) {
      $("micDot").classList.remove("live");
      $("startVC").disabled = !voiceRef;
      $("stopVC").disabled = true;
      return;
    }
    setTimeout(() => {
      if (listening && !generating) {
        try { recognition.start(); } catch {}
      }
    }, 150);
  };
}

$("loadModel").addEventListener("click", loadModel);
$("cloneFile").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) cloneFile(file);
});

$("loadBuiltin").addEventListener("click", async () => {
  if (!tts) return;
  const name = $("builtinVoice").value;
  setVoiceStatus(`Loading ${name}…`, "working");
  try {
    voiceRef = await tts.loadVoice(name);
    setVoiceStatus(`✓ Built-in voice: ${name}`, "ok");
    $("generate").disabled = false;
    $("startVC").disabled = !browserSupportsSTT();
    log(`Loaded built-in voice: ${name}.`);
  } catch (error) {
    setVoiceStatus(`Voice failed: ${error.message}`, "bad");
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
  a.download = "voicechanger-browser.wav";
  a.click();
});

$("startVC").addEventListener("click", () => {
  if (!recognition || !voiceRef) return;
  listening = true;
  try { recognition.start(); } catch {}
});

$("stopVC").addEventListener("click", () => {
  listening = false;
  recognition?.stop();
  $("micDot").classList.remove("live");
  setStatus("VoiceChanger stopped.");
  $("startVC").disabled = !voiceRef;
  $("stopVC").disabled = true;
});

if (browserSupportsSTT()) {
  setupSpeechRecognition();
  $("sttInfo").textContent = "Microphone speech recognition available.";
} else {
  $("sttInfo").textContent = "This browser does not expose SpeechRecognition.";
}

$("secureInfo").textContent = window.isSecureContext ? "Secure browser context ✓" : "Use the hosted HTTPS app for microphone access.";
log("VoiceChanger app loaded. Load Browser AI to begin.");
