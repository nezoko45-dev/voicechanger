import { PocketTTS, StreamingPlayer } from "pocket-tts-js";

const $ = id => document.getElementById(id);
const status = $("status");
const meter = $("meter");
const silenceSelect = $("silence");
const outputSelect = $("output");
const startButton = $("start");
const stopButton = $("stop");
const referenceButton = $("reference");

let tts = null;
let player = null;
let clonedVoice = null;
let referenceFile = null;
let recognition = null;
let micStream = null;
let analyser = null;
let micContext = null;
let monitorFrame = 0;
let silenceTimer = 0;
let running = false;
let speechActive = false;
let finalText = "";
let interimText = "";
let speaking = false;
let generation = 0;

function setStatus(text) { status.textContent = text; }

async function refreshOutputs() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    outputSelect.innerHTML = '<option value="">Default output</option>';
    devices.filter(d => d.kind === "audiooutput").forEach((d, i) => {
      const option = document.createElement("option");
      option.value = d.deviceId;
      option.textContent = d.label || `Speaker ${i + 1}`;
      outputSelect.appendChild(option);
    });
  } catch {}
}

async function setOutput() {
  if (!player?.audioContext || !outputSelect.value) return;
  if (typeof player.audioContext.setSinkId !== "function") {
    setStatus("This Chrome build does not expose Web Audio speaker selection; using the default output.");
    return;
  }
  try {
    await player.audioContext.setSinkId(outputSelect.value);
    setStatus("Output changed.");
  } catch (e) {
    setStatus(`Output error: ${e.message || e}`);
  }
}
outputSelect.addEventListener("change", setOutput);

referenceButton.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/*,.wav";
  input.onchange = () => {
    referenceFile = input.files?.[0] || null;
    if (referenceFile) setStatus(`Reference selected: ${referenceFile.name}. Press START to load it.`);
  };
  input.click();
});

async function prepareVoice() {
  if (!referenceFile) throw new Error("Choose a reference WAV first.");
  setStatus("Encoding your reference voice…");
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await referenceFile.arrayBuffer());
  const mono = new Float32Array(decoded.length);
  if (decoded.numberOfChannels === 1) {
    mono.set(decoded.getChannelData(0));
  } else {
    for (let i = 0; i < decoded.length; i++) {
      let v = 0;
      for (let c = 0; c < decoded.numberOfChannels; c++) v += decoded.getChannelData(c)[i];
      mono[i] = v / decoded.numberOfChannels;
    }
  }
  clonedVoice = await tts.cloneVoice(mono, { inputSampleRate: decoded.sampleRate, name: "my-clone" });
  await ctx.close();
}

function startRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) throw new Error("Chrome SpeechRecognition is unavailable.");
  recognition = new Recognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = event => {
    let newestFinal = "";
    let newestInterim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) newestFinal += result[0].transcript + " ";
      else newestInterim += result[0].transcript;
    }
    if (newestFinal) finalText += newestFinal;
    interimText = newestInterim;
  };
  recognition.onerror = e => {
    if (running && e.error !== "aborted") setStatus(`Speech recognition: ${e.error}`);
  };
  recognition.onend = () => {
    if (running) setTimeout(() => { try { recognition.start(); } catch {} }, 80);
  };
  recognition.start();
}

async function startMicMonitor() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  micContext = new AudioContext();
  const source = micContext.createMediaStreamSource(micStream);
  analyser = micContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.15;
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);

  const tick = () => {
    if (!running) return;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const x of data) sum += x * x;
    const rms = Math.sqrt(sum / data.length);
    const active = rms > 0.012;
    meter.style.width = `${Math.min(100, rms * 900)}%`;

    if (active) {
      speechActive = true;
      clearTimeout(silenceTimer);
    } else if (speechActive && !speaking) {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        speechActive = false;
        speakPending();
      }, Number(silenceSelect.value));
    }
    monitorFrame = requestAnimationFrame(tick);
  };
  monitorFrame = requestAnimationFrame(tick);
}

async function speakPending() {
  const text = `${finalText} ${interimText}`.replace(/\s+/g, " ").trim();
  finalText = "";
  interimText = "";
  if (!text || !clonedVoice || !tts || !player) return;

  const id = ++generation;
  speaking = true;
  try {
    await tts.stop();
    player.reset();
    setStatus(`Speaking immediately after silence: ${text}`);
    await tts.generate(text, {
      voice: clonedVoice,
      onChunk: (audio, meta) => {
        if (id === generation) player.play(audio, meta);
      }
    });
    if (id === generation) player.flush();
  } catch (e) {
    if (id === generation) setStatus(`TTS error: ${e.message || e}`);
  } finally {
    if (id === generation) speaking = false;
  }
}

startButton.addEventListener("click", async () => {
  if (running) return;
  try {
    running = true;
    startButton.disabled = true;
    setStatus("Loading Pocket TTS INT8 model… this first load is cached by Chrome.");

    tts = new PocketTTS({
      language: "english_2026-04",
      quantized: true,
      voiceCloning: true,
      cache: true,
      maxThreads: 1
    });
    await tts.load(p => {
      if (p?.total) meter.style.width = `${Math.min(100, 100 * p.loaded / p.total)}%`;
    });

    player = new StreamingPlayer({
      sampleRate: tts.sampleRate,
      primeSeconds: 0.10,
      leadSeconds: 0.02,
      onUnderrun: info => console.debug("Pocket TTS underrun", info)
    });
    await player.resume();
    await refreshOutputs();
    await prepareVoice();
    await startMicMonitor();
    startRecognition();
    setStatus(`READY — speak, then stop for ${silenceSelect.value} ms. Pocket TTS streams the cloned voice as it generates.`);
  } catch (e) {
    running = false;
    startButton.disabled = false;
    setStatus(`Start error: ${e.message || e}`);
    console.error(e);
  }
});

stopButton.addEventListener("click", async () => {
  running = false;
  speaking = false;
  generation++;
  clearTimeout(silenceTimer);
  cancelAnimationFrame(monitorFrame);
  try { recognition?.abort(); } catch {}
  try { await tts?.stop(); } catch {}
  try { player?.stop(); } catch {}
  micStream?.getTracks().forEach(t => t.stop());
  if (micContext) await micContext.close().catch(() => {});
  setStatus("Stopped.");
  startButton.disabled = false;
});
