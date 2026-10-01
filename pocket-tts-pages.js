import { PocketTTS, StreamingPlayer } from "./pocket-tts/index.js";

const status = document.getElementById("status");
const startBtn = document.getElementById("load");
const stopBtn = document.getElementById("stop");
const micSelect = document.getElementById("mic");
const outputSelect = document.getElementById("output");
const meter = document.getElementById("meter");
const silenceSelect = document.getElementById("silence");
const referenceBtn = document.getElementById("reference");
const outputAudio = document.getElementById("mp3");

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
let vadContext = null;
let vadSource = null;
let vadAnalyser = null;
let vadFrame = null;
let lastVoiceTime = 0;
let outputUrl = null;

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
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || `Microphone ${i + 1}`;
      micSelect.appendChild(o);
    });
    devices.filter(d => d.kind === "audiooutput").forEach((d, i) => {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || `Speaker ${i + 1}`;
      outputSelect.appendChild(o);
    });
    if ([...micSelect.options].some(o => o.value === oldMic)) micSelect.value = oldMic;
    if ([...outputSelect.options].some(o => o.value === oldOut)) outputSelect.value = oldOut;
  } catch {}
}

async function chooseOutput() {
  const sinkId = outputSelect.value;
  if (!sinkId) return;
  if (player?.audioContext && typeof player.audioContext.setSinkId === "function") {
    await player.audioContext.setSinkId(sinkId);
  }
  if (typeof outputAudio.setSinkId === "function") await outputAudio.setSinkId(sinkId);
}

outputSelect.addEventListener("change", () => chooseOutput().catch(e => setStatus(`Output error: ${e.message || e}`)));
document.getElementById("choose")?.addEventListener("click", () => chooseOutput().catch(e => setStatus(`Output error: ${e.message || e}`)));

function pickReference() {
  return new Promise(resolve => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "audio/*,.wav";
    picker.onchange = () => { referenceFile = picker.files?.[0] || null; resolve(referenceFile); };
    picker.click();
  });
}

referenceBtn.addEventListener("click", async () => {
  const file = await pickReference();
  if (!file) return;
  if (!tts) { setStatus("Reference selected. Press START to load Pocket TTS."); return; }
  try { await loadReference(file); } catch (e) { setStatus(`Voice clone error: ${e.message || e}`); }
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
    clonedVoice = await tts.cloneVoice(mono, {
      inputSampleRate: decoded.sampleRate,
      name: "github-pages-wav-voice"
    });
    await tts.finishLoad();
    setStatus("WAV voice cloned. Speak into the selected microphone.");
  } finally { await ctx.close(); }
}

async function startRawMicCapture() {
  stopRawMicCapture();
  const constraints = micSelect.value
    ? { audio: { deviceId: { exact: micSelect.value }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
    : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
  micStream = await navigator.mediaDevices.getUserMedia(constraints);
  vadContext = new AudioContext();
  vadSource = vadContext.createMediaStreamSource(micStream);
  vadAnalyser = vadContext.createAnalyser();
  vadAnalyser.fftSize = 1024;
  vadAnalyser.smoothingTimeConstant = 0.15;
  vadSource.connect(vadAnalyser);
  await vadContext.resume();
  lastVoiceTime = performance.now();
  runMicMeter();
}

function runMicMeter() {
  if (!running || !vadAnalyser) return;
  const data = new Uint8Array(vadAnalyser.fftSize);
  vadAnalyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
  const rms = Math.sqrt(sum / data.length);
  meter.style.width = `${Math.min(100, Math.max(2, rms * 500))}%`;
  if (rms > 0.018) lastVoiceTime = performance.now();
  vadFrame = requestAnimationFrame(runMicMeter);
}

function stopRawMicCapture() {
  if (vadFrame) cancelAnimationFrame(vadFrame);
  vadFrame = null;
  try { vadSource?.disconnect(); vadAnalyser?.disconnect(); } catch {}
  try { vadContext?.close(); } catch {}
  vadSource = null; vadAnalyser = null; vadContext = null;
  micStream?.getTracks().forEach(t => t.stop());
  micStream = null;
}

function pcmToWavBlob(chunks, sampleRate) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const pcm = new Float32Array(total);
  let pos = 0;
  for (const c of chunks) { pcm.set(c, pos); pos += c.length; }
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const write = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + pcm.length * 2, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, pcm.length * 2, true);
  let off = 44;
  for (const x of pcm) { const s = Math.max(-1, Math.min(1, x)); view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2; }
  return new Blob([buffer], { type: "audio/wav" });
}

async function speak(text) {
  text = text.trim();
  if (!text || !clonedVoice || !tts || !player) return;
  const id = ++generationId;
  const chunks = [];
  try {
    await tts.stop();
    player.reset();
    setStatus(`Converting: ${text}`);
    await tts.generate(text, {
      voice: clonedVoice,
      onChunk: (audio, meta) => {
        if (id !== generationId) return;
        const data = audio instanceof Float32Array ? audio : new Float32Array(audio);
        chunks.push(new Float32Array(data));
        player.play(audio, meta);
      }
    });
    if (id === generationId) {
      player.flush();
      if (chunks.length) {
        const blob = pcmToWavBlob(chunks, tts.sampleRate);
        if (outputUrl) URL.revokeObjectURL(outputUrl);
        outputUrl = URL.createObjectURL(blob);
        outputAudio.src = outputUrl;
        outputAudio.load();
        await outputAudio.play().catch(() => {});
      }
      setStatus("Listening…");
    }
  } catch (e) {
    if (id === generationId) setStatus(`TTS error: ${e.message || e}`);
  }
}

function scheduleSpeech() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    const text = `${finalText} ${interimText}`.trim();
    finalText = "";
    interimText = "";
    if (text) speak(text);
  }, silenceMs());
}

function startRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) throw new Error("Chrome SpeechRecognition is unavailable.");
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.onstart = () => setStatus(`Listening… cloned output starts ${silenceMs()} ms after silence.`);
  recognition.onresult = e => {
    interimText = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i], transcript = r[0]?.transcript || "";
      if (r.isFinal) finalText += transcript + " ";
      else interimText += transcript;
    }
    if (finalText.trim() || interimText.trim()) scheduleSpeech();
  };
  recognition.onerror = e => { if (e.error !== "aborted") setStatus(`Speech recognition: ${e.error}`); };
  recognition.onend = () => { if (running) setTimeout(() => { try { recognition.start(); } catch {} }, 50); };
  recognition.start();
}

startBtn.addEventListener("click", async () => {
  if (running) return;
  try {
    running = true;
    startBtn.disabled = true;
    setStatus("Loading Pocket TTS… first load downloads and caches the INT8 model.");
    tts = new PocketTTS({ language: "english_2026-04", quantized: true, voiceCloning: true, cache: true, maxThreads: 1 });
    await tts.load(p => {
      if (p?.total) meter.style.width = `${Math.min(100, p.loaded / p.total * 100)}%`;
      if (p?.label) setStatus(`${p.label}…`);
    });
    player = new StreamingPlayer({ sampleRate: tts.sampleRate, primeSeconds: 0.12, leadSeconds: 0.02 });
    await player.resume();
    await refreshDevices();
    await chooseOutput().catch(() => {});
    if (!referenceFile) referenceFile = await pickReference();
    if (!referenceFile) throw new Error("Choose a WAV reference to clone your voice.");
    await loadReference(referenceFile);
    await startRawMicCapture();
    startRecognition();
  } catch (e) {
    running = false;
    startBtn.disabled = false;
    try { recognition?.stop(); } catch {}
    stopRawMicCapture();
    setStatus(`Start error: ${e.message || e}`);
  }
});

stopBtn.addEventListener("click", async () => {
  running = false;
  clearTimeout(silenceTimer);
  finalText = "";
  interimText = "";
  generationId++;
  try { recognition?.stop(); } catch {}
  try { await tts?.stop(); } catch {}
  try { player?.stop(); } catch {}
  stopRawMicCapture();
  setStatus("Stopped.");
  startBtn.disabled = false;
});

micSelect.addEventListener("change", async () => {
  if (!running) return;
  try {
    await startRawMicCapture();
    setStatus("Microphone changed. Listening…");
  } catch (e) { setStatus(`Microphone error: ${e.message || e}`); }
});

navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
refreshDevices();
