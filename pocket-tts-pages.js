import { PocketTTS, StreamingPlayer } from "./pocket-tts/index.js";

const status = document.getElementById("status");
const startBtn = document.getElementById("load");
const stopBtn = document.getElementById("stop");
const micSelect = document.getElementById("mic");
const outputSelect = document.getElementById("output");
const meter = document.getElementById("meter");
const silenceSelect = document.getElementById("silence");
const referenceBtn = document.getElementById("reference");
const mp3 = document.getElementById("mp3");
const mp3Pick = document.getElementById("mp3Pick");
const monitor = document.getElementById("monitor");

let tts = null;
let player = null;
let clonedVoice = null;
let running = false;
let recognition = null;
let silenceTimer = null;
let finalText = "";
let interimText = "";
let generationId = 0;
let referenceFile = null;
let micStream = null;
let monitorContext = null;
let monitorSource = null;
let monitorGain = null;
let mp3Url = null;
let mp3Context = null;
let mp3Source = null;

function setStatus(text) { status.textContent = text; }
function silenceMs() { return Number(silenceSelect?.value || 320); }

async function refreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const oldMic = micSelect.value;
    const oldOut = outputSelect.value;
    micSelect.innerHTML = '<option value="">Default microphone</option>';
    outputSelect.innerHTML = '<option value="">Default output</option>';
    devices.filter(d => d.kind === "audioinput").forEach((d, i) => {
      const o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || `Microphone ${i + 1}`; micSelect.appendChild(o);
    });
    devices.filter(d => d.kind === "audiooutput").forEach((d, i) => {
      const o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || `Speaker ${i + 1}`; outputSelect.appendChild(o);
    });
    if ([...micSelect.options].some(o => o.value === oldMic)) micSelect.value = oldMic;
    if ([...outputSelect.options].some(o => o.value === oldOut)) outputSelect.value = oldOut;
  } catch {}
}

async function chooseOutput() {
  const sinkId = outputSelect.value;
  if (!sinkId) return;
  if (player?.audioContext && typeof player.audioContext.setSinkId === "function") await player.audioContext.setSinkId(sinkId);
  if (monitorContext && typeof monitorContext.setSinkId === "function") await monitorContext.setSinkId(sinkId);
  if (mp3Context && typeof mp3Context.setSinkId === "function") await mp3Context.setSinkId(sinkId);
}

outputSelect.addEventListener("change", () => chooseOutput().catch(e => setStatus(`Output error: ${e.message || e}`)));
document.getElementById("choose")?.addEventListener("click", () => chooseOutput().catch(e => setStatus(`Output error: ${e.message || e}`)));

function pickReference() {
  return new Promise(resolve => {
    const picker = document.createElement("input"); picker.type = "file"; picker.accept = "audio/*,.wav";
    picker.onchange = () => { referenceFile = picker.files?.[0] || null; resolve(referenceFile); }; picker.click();
  });
}

referenceBtn.addEventListener("click", async () => {
  const file = await pickReference();
  if (!file) return;
  if (!tts) { setStatus("Reference selected. Press START to load Pocket TTS."); return; }
  try { await loadReference(file); } catch (e) { setStatus(`Voice clone error: ${e.message || e}`); }
});

function pickMp3() {
  return new Promise(resolve => {
    const picker = document.createElement("input"); picker.type = "file"; picker.accept = "audio/mpeg,.mp3,audio/*";
    picker.onchange = () => resolve(picker.files?.[0] || null); picker.click();
  });
}

mp3Pick.addEventListener("click", async () => {
  const file = await pickMp3();
  if (!file) return;
  if (mp3Url) URL.revokeObjectURL(mp3Url);
  mp3Url = URL.createObjectURL(file);
  mp3.src = mp3Url;
  mp3.load();
  setStatus(`MP3 loaded: ${file.name}. Press play when ready.`);
});

async function loadReference(file) {
  setStatus("Encoding your WAV reference…");
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration < 1) throw new Error("Use at least 1 second of clear speech.");
    const mono = new Float32Array(decoded.length);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    clonedVoice = await tts.cloneVoice(mono, { inputSampleRate: decoded.sampleRate, name: "github-pages-wav-voice" });
    await tts.finishLoad();
    setStatus("Voice cloned. Speak normally; TTS starts after silence.");
  } finally { await ctx.close(); }
}

async function startMicMonitor() {
  if (monitorContext) return;
  if (!micStream) {
    const constraints = micSelect.value ? { audio: { deviceId: { exact: micSelect.value } } } : { audio: true };
    micStream = await navigator.mediaDevices.getUserMedia(constraints);
    await refreshDevices();
  }
  monitorContext = new AudioContext();
  monitorSource = monitorContext.createMediaStreamSource(micStream);
  monitorGain = monitorContext.createGain();
  monitorGain.gain.value = 1;
  monitorSource.connect(monitorGain).connect(monitorContext.destination);
  await monitorContext.resume();
  await chooseOutput().catch(() => {});
}

function stopMicMonitor() {
  try { monitorSource?.disconnect(); monitorGain?.disconnect(); } catch {}
  try { monitorContext?.close(); } catch {}
  monitorSource = null; monitorGain = null; monitorContext = null;
}

monitor.addEventListener("change", async () => {
  try {
    if (monitor.checked) {
      await startMicMonitor();
      setStatus("Microphone monitoring ON — you should hear your mic live. Use headphones to avoid feedback.");
    } else {
      stopMicMonitor();
      if (running) setStatus("Listening…");
    }
  } catch (e) {
    monitor.checked = false;
    setStatus(`Mic monitor error: ${e.message || e}`);
  }
});

async function speak(text) {
  text = text.trim(); if (!text || !clonedVoice || !tts || !player) return;
  const id = ++generationId;
  try {
    await tts.stop(); player.reset(); setStatus(`Speaking: ${text}`);
    await tts.generate(text, { voice: clonedVoice, onChunk: (audio, meta) => { if (id === generationId) player.play(audio, meta); } });
    if (id === generationId) player.flush();
    setStatus("Listening…");
  } catch (e) { if (id === generationId) setStatus(`TTS error: ${e.message || e}`); }
}

function scheduleSpeech() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    const text = `${finalText} ${interimText}`.trim(); finalText = ""; interimText = "";
    if (text) speak(text);
  }, silenceMs());
}

function startRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) throw new Error("Chrome SpeechRecognition is unavailable.");
  recognition = new SR(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = "en-US";
  recognition.onstart = () => setStatus(`Listening… TTS starts ${silenceMs()} ms after you stop speaking.`);
  recognition.onresult = e => {
    interimText = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i], transcript = r[0]?.transcript || "";
      if (r.isFinal) finalText += transcript + " "; else interimText += transcript;
    }
    if (finalText.trim() || interimText.trim()) { meter.style.width = "100%"; scheduleSpeech(); }
  };
  recognition.onerror = e => { if (e.error !== "aborted") setStatus(`Speech recognition: ${e.error}`); };
  recognition.onend = () => { if (running) setTimeout(() => { try { recognition.start(); } catch {} }, 50); };
  recognition.start();
}

startBtn.addEventListener("click", async () => {
  if (running) return;
  try {
    running = true; startBtn.disabled = true; setStatus("Loading Pocket TTS… first load downloads and caches the INT8 model.");
    tts = new PocketTTS({ language: "english_2026-04", quantized: true, voiceCloning: true, cache: true, maxThreads: 1 });
    await tts.load(p => { if (p?.total) meter.style.width = `${Math.min(100, p.loaded / p.total * 100)}%`; if (p?.label) setStatus(`${p.label}…`); });
    player = new StreamingPlayer({ sampleRate: tts.sampleRate, primeSeconds: 0.12, leadSeconds: 0.02 });
    await player.resume(); await refreshDevices(); await chooseOutput().catch(() => {});
    if (!referenceFile) referenceFile = await pickReference();
    if (!referenceFile) throw new Error("Choose a WAV reference to clone your voice.");
    await loadReference(referenceFile);
    if (monitor.checked) await startMicMonitor();
    startRecognition();
  } catch (e) {
    running = false; startBtn.disabled = false; try { recognition?.stop(); } catch {} setStatus(`Start error: ${e.message || e}`);
  }
});

stopBtn.addEventListener("click", async () => {
  running = false; clearTimeout(silenceTimer); finalText = ""; interimText = ""; generationId++;
  try { recognition?.stop(); } catch {} try { await tts?.stop(); } catch {} try { player?.stop(); } catch {}
  stopMicMonitor(); monitor.checked = false; setStatus("Stopped."); startBtn.disabled = false;
});

micSelect.addEventListener("change", async () => {
  if (monitor.checked) { stopMicMonitor(); try { await startMicMonitor(); } catch (e) { monitor.checked = false; setStatus(`Mic monitor error: ${e.message || e}`); } }
  else setStatus("Microphone selected. Chrome SpeechRecognition uses Chrome's active input device.");
});

navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
refreshDevices();
