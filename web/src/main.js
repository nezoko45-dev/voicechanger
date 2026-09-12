import { PocketTTS, LANGUAGES, StreamingPlayer, chunksToWavBlob } from "pocket-tts-js";

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
  box.textContent = `${message}\n${box.textContent}`;
}

function setStatus(text, type = "") {
  $("status").textContent = text;
  $("status").className = `status ${type}`;
}

function setVoiceStatus(text, type = "") {
  $("voiceStatus").textContent = text;
  $("voiceStatus").className = `status ${type}`;
}

function bytes(n) {
  return `${(n / 1e6).toFixed(1)} MB`;
}

function browserSupportsSTT() {
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

async function loadModel() {
  $("loadModel").disabled = true;
  $("loadModel").textContent = "Loading…";
  setStatus("Downloading the browser model…", "working");
  log("Starting Pocket TTS browser model.");

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
        const pct = Math.floor((info.loaded / info.total) * 20) * 5;
        const key = info.label || "model";
        if (seen.get(key) !== pct) {
          seen.set(key, pct);
          log(`${key}: ${pct}% (${bytes(info.total)})${info.fromCache ? " [cached]" : ""}`);
        }
      } else if (info.status) {
        log(`Model: ${info.status}`);
      }
    });

    player = new StreamingPlayer({
      sampleRate: tts.sampleRate,
      primeSeconds: 0.18,
      onUnderrun: (u) => log(`Audio underrun: ${Math.round(u.gapSeconds * 1000)}ms`),
    });

    $("modelInfo").textContent = `Ready • ${tts.sampleRate} Hz • INT8 • ${bundle.predefinedVoices.length} built-in voices`;
    $("cloneFile").disabled = false;
    $("loadBuiltin").disabled = bundle.predefinedVoices.length === 0;
    $("builtinVoice").innerHTML = bundle.predefinedVoices
      .map((voice) => `<option value="${voice}">${voice}</option>`)
      .join("");
    $("generate").disabled = true;
    $("download").disabled = true;
    setStatus("Browser model ready. Load a WAV voice reference.", "ok");
    log("Model ready. Nothing is running on a server.");
  } catch (error) {
    console.error(error);
    setStatus(`Model failed: ${error.message}`, "bad");
    log(`MODEL ERROR: ${error.stack || error.message}`);
  } finally {
    $("loadModel").disabled = false;
    $("loadModel").textContent = "Reload browser model";
  }
}

async function cloneFile(file) {
  if (!tts) return;
  setVoiceStatus("Encoding voice reference…", "working");
  $("cloneFile").disabled = true;
  try {
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration < 2) throw new Error("Use a voice sample at least 2 seconds long.");
    const mono = buffer.getChannelData(0);
    voiceRef = await tts.cloneVoice(mono, {
      inputSampleRate: buffer.sampleRate,
      name: file.name,
    });
    await ctx.close();
    setVoiceStatus(`Cloned: ${file.name}`, "ok");
    $("generate").disabled = false;
    $("startVC").disabled = !browserSupportsSTT();
    log(`Voice cloned locally from ${file.name}. The WAV was not uploaded.`);
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
  voiceChunks = [];
  player.reset();
  await player.resume();

  const started = performance.now();
  let firstAudio = false;
  log(`Generating: ${text.trim().slice(0, 80)}`);
  try {
    const metrics = await tts.generate(text.trim().slice(0, 1200), {
      voice: voiceRef,
      onChunk: (audio, meta) => {
        if (!firstAudio && !meta.isSilence) {
          firstAudio = true;
          log(`First audio: ${Math.round(performance.now() - started)}ms`);
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
    }
    log(`Done • ${metrics.audioDuration.toFixed(2)}s audio • ${metrics.rtfx.toFixed(2)}x realtime`);
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
    $("sttInfo").textContent = "Browser speech recognition is unavailable here.";
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
    setStatus("VoiceChanger listening…", "ok");
    log("VoiceChanger started.");
  };

  recognition.onresult = async (event) => {
    const last = event.results[event.results.length - 1];
    if (!last.isFinal) return;
    const text = last[0].transcript.trim();
    if (!text || !voiceRef || generating) return;
    log(`You: ${text}`);
    recognition.stop();
    await generate(text);
    if (listening) {
      try { recognition.start(); } catch {}
    }
  };

  recognition.onerror = (event) => {
    log(`STT: ${event.error}`);
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      listening = false;
      setStatus("Microphone/speech permission was denied.", "bad");
    }
  };

  recognition.onend = () => {
    if (!listening) {
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
    setVoiceStatus(`Built-in voice: ${name}`, "ok");
    $("generate").disabled = false;
    $("startVC").disabled = !browserSupportsSTT();
    log(`Loaded built-in voice: ${name}`);
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
  setStatus("VoiceChanger stopped.", "");
  $("startVC").disabled = !voiceRef;
  $("stopVC").disabled = true;
});

if (browserSupportsSTT()) {
  setupSpeechRecognition();
  $("sttInfo").textContent = "Browser speech recognition available.";
} else {
  $("sttInfo").textContent = "This browser does not expose SpeechRecognition. TTS still works.";
}

$("secureInfo").textContent = window.isSecureContext
  ? "Secure browser context ✓"
  : "Open this through HTTPS or localhost for microphone/model caching.";

log("Ready. Click Load Browser Model to begin.");
