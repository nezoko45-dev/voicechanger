import { PocketTTS, StreamingPlayer, chunksToWavBlob } from "./pocket-tts/index.js";

const status = document.getElementById("status");
const startBtn = document.getElementById("load");
const stopBtn = document.getElementById("stop");
const micSelect = document.getElementById("mic");
const outputSelect = document.getElementById("output");
const meter = document.getElementById("meter");
const silenceSelect = document.getElementById("silence");
const referenceBtn = document.getElementById("reference");
const outputAudio = document.getElementById("mp3");
const testVoiceBtn = document.getElementById("testVoice");
const replayBtn = document.getElementById("replay");

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
  if (typeof outputAudio.setSinkId === "function") await outputAudio.setSinkId(sinkId);
}

outputSelect.addEventListener("change", () => chooseOutput().catch(e => setStatus(`Output error: ${e.message || e}`)));
document.getElementById("choose")?.addEventListener("click", () => chooseOutput().catch(e => setStatus(`Output error: ${e.message || e}`)));

function pickReference() {
  return new Promise(resolve => {
    const picker = document.createElement("input"); picker.type = "file"; picker.accept = "audio/wav,.wav,audio/*";
    picker.onchange = () => { referenceFile = picker.files?.[0] || null; resolve(referenceFile); }; picker.click();
  });
}

referenceBtn.addEventListener("click", async () => {
  const file = await pickReference();
  if (!file) return;
  if (!tts) { setStatus(`Reference selected: ${file.name}. Press START to load Pocket TTS.`); return; }
  try { await loadReference(file); } catch (e) { setStatus(`Voice clone error: ${e.message || e}`); }
});

async function loadReference(file) {
  setStatus(`Loading reference voice: ${file.name}…`);
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration < 1) throw new Error("Use at least 1 second of clear speech in the WAV.");
    const mono = new Float32Array(decoded.length);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    clonedVoice = await tts.cloneVoice(mono, { inputSampleRate: decoded.sampleRate, name: "github-pages-wav-voice" });
    await tts.finishLoad();
    setStatus(`WAV voice loaded: ${file.name}. Click TEST WAV VOICE to verify it, or START speaking.`);
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

async function playGeneratedChunks(chunks) {
  if (!chunks.length || !tts) throw new Error("Pocket TTS returned no audio chunks.");
  const blob = chunksToWavBlob(chunks, tts.sampleRate);
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = URL.createObjectURL(blob);
  outputAudio.src = outputUrl;
  outputAudio.load();
  await chooseOutput().catch(() => {});
  try { await outputAudio.play(); } catch (e) {
    // Chrome can block a second media element; the StreamingPlayer should still be audible.
    setStatus("Generated voice is ready in the player. Press play if Chrome blocked autoplay.");
  }
}

async function speak(text) {
  text = text.trim();
  if (!text || !clonedVoice || !tts || !player) return;
  const id = ++generationId;
  const chunks = [];
  try {
    await tts.stop();
    player.reset();
    await player.resume();
    setStatus(`Converting with your WAV voice: ${text}`);
    await tts.generate(text, {
      voice: clonedVoice,
      onChunk: (audio, meta) => {
        if (id !== generationId) return;
        const data = audio instanceof Float32Array ? audio : new Float32Array(audio);
        chunks.push(new Float32Array(data));
        player.play(data, meta);
      }
    });
    if (id !== generationId) return;
    player.flush();
    await playGeneratedChunks(chunks);
    if (id === generationId) setStatus("Listening…");
  } catch (e) {
    if (id === generationId) setStatus(`TTS error: ${e.message || e}`);
  }
}

testVoiceBtn.addEventListener("click", async () => {
  if (!tts || !clonedVoice) {
    setStatus("Press START and choose your reference WAV first.");
    return;
  }
  await speak("This is a test of my cloned voice.");
});

replayBtn.addEventListener("click", async () => {
  if (!outputAudio.src) { setStatus("No converted voice is ready yet."); return; }
  try { await chooseOutput(); await outputAudio.play(); } catch (e) { setStatus(`Replay error: ${e.message || e}`); }
});

function scheduleSpeech() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    const text = `${finalText} ${interimText}`.trim();
    finalText = ""; interimText = "";
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
  recognition.onstart = () => setStatus(`Listening… your WAV clone starts ${silenceMs()} ms after silence.`);
  recognition.onresult = e => {
    interimText = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i], transcript = r[0]?.transcript || "";
      if (r.isFinal) finalText += transcript + " "; else interimText += transcript;
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
    running = true; startBtn.disabled = true;
    setStatus("Loading Pocket TTS… first load downloads and caches the INT8 model.");
    tts = new PocketTTS({ language: "english_2026-04", quantized: true, voiceCloning: true, cache: true, maxThreads: 1 });
    await tts.load(p => {
      if (p?.total) meter.style.width = `${Math.min(100, p.loaded / p.total * 100)}%`;
      if (p?.label) setStatus(`${p.label}…`);
    });
    player = new StreamingPlayer({ sampleRate: tts.sampleRate, primeSeconds: 0.08, leadSeconds: 0.02 });
    await player.resume();
    await refreshDevices();
    await chooseOutput().catch(() => {});
    if (!referenceFile) referenceFile = await pickReference();
    if (!referenceFile) throw new Error("Choose a WAV reference to clone your voice.");
    await loadReference(referenceFile);
    await startRawMicCapture();
    startRecognition();
  } catch (e) {
    running = false; startBtn.disabled = false;
    try { recognition?.stop(); } catch {}
    stopRawMicCapture();
    setStatus(`Start error: ${e.message || e}`);
  }
});

stopBtn.addEventListener("click", async () => {
  running = false; clearTimeout(silenceTimer); finalText = ""; interimText = ""; generationId++;
  try { recognition?.stop(); } catch {}
  try { await tts?.stop(); } catch {}
  try { player?.stop(); } catch {}
  stopRawMicCapture();
  setStatus("Stopped."); startBtn.disabled = false;
});

micSelect.addEventListener("change", async () => {
  if (!running) return;
  try { await startRawMicCapture(); setStatus("Microphone changed. Listening…"); }
  catch (e) { setStatus(`Microphone error: ${e.message || e}`); }
});

navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
refreshDevices();
