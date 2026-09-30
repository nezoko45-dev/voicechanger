import { PocketTTS, StreamingPlayer } from "https://cdn.jsdelivr.net/npm/pocket-tts-js@latest/dist/index.js";

const status = document.getElementById("status");
const startBtn = document.getElementById("load");
const stopBtn = document.getElementById("stop");
const micSelect = document.getElementById("mic");
const outputSelect = document.getElementById("output");
const meter = document.getElementById("meter");

let tts = null;
let player = null;
let clonedVoice = null;
let running = false;
let recognizing = false;
let recognition = null;
let silenceTimer = null;
let finalText = "";
let generationId = 0;

const SILENCE_MS = 320;

function setStatus(s) { status.textContent = s; }

async function refreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    micSelect.innerHTML = '<option value="">Default microphone</option>';
    outputSelect.innerHTML = '<option value="">Default output</option>';
    devices.filter(d => d.kind === "audioinput").forEach((d, i) => {
      const o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || `Microphone ${i + 1}`; micSelect.appendChild(o);
    });
    devices.filter(d => d.kind === "audiooutput").forEach((d, i) => {
      const o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || `Speaker ${i + 1}`; outputSelect.appendChild(o);
    });
  } catch {}
}

async function chooseOutput() {
  if (!outputSelect.value) return;
  if (player?.audioContext?.setSinkId) {
    await player.audioContext.setSinkId(outputSelect.value);
    setStatus("Output selected.");
  } else {
    setStatus("Chrome does not expose output selection for this audio path; using the default speaker.");
  }
}

document.getElementById("choose")?.addEventListener("click", chooseOutput);
outputSelect.addEventListener("change", chooseOutput);

async function cloneReference() {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "audio/*,.wav";
  picker.onchange = async () => {
    const file = picker.files?.[0];
    if (!file || !tts) return;
    setStatus("Encoding reference voice…");
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    const mono = decoded.getChannelData(0).slice();
    clonedVoice = await tts.cloneVoice(mono, { inputSampleRate: decoded.sampleRate, name: "my-clone" });
    await ctx.close();
    setStatus("Reference voice loaded. Start speaking.");
  };
  picker.click();
}

async function speak(text) {
  text = text.trim();
  if (!text || !clonedVoice || !tts || !player) return;
  const id = ++generationId;
  try {
    await tts.stop();
    player.reset();
    setStatus(`Generating: ${text}`);
    await tts.generate(text, {
      voice: clonedVoice,
      onChunk: (audio, meta) => {
        if (id === generationId) player.play(audio, meta);
      }
    });
    if (id === generationId) player.flush();
  } catch (e) {
    if (id === generationId) setStatus(`TTS error: ${e.message || e}`);
  }
}

function scheduleSpeech() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    const text = finalText.trim();
    finalText = "";
    if (text) speak(text);
  }, SILENCE_MS);
}

function startRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) throw new Error("Chrome SpeechRecognition is unavailable in this browser.");
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.onstart = () => { recognizing = true; setStatus("Listening… stop speaking and TTS starts after 320 ms of silence."); };
  recognition.onresult = e => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + " ";
      else interim += r[0].transcript;
    }
    if (finalText.trim() || interim.trim()) {
      meter.style.width = "100%";
      scheduleSpeech();
    }
  };
  recognition.onerror = e => setStatus(`Speech recognition: ${e.error}`);
  recognition.onend = () => {
    recognizing = false;
    if (running) setTimeout(() => { try { recognition.start(); } catch {} }, 50);
  };
  recognition.start();
}

startBtn.addEventListener("click", async () => {
  if (running) return;
  try {
    running = true;
    startBtn.disabled = true;
    setStatus("Loading Pocket TTS… first load downloads and caches the INT8 browser model.");
    tts = new PocketTTS({ language: "english_2026-04", quantized: true, voiceCloning: true, cache: true });
    await tts.load(p => {
      if (p?.total) meter.style.width = `${Math.min(100, p.loaded / p.total * 100)}%`;
    });
    player = new StreamingPlayer({ sampleRate: tts.sampleRate });
    await player.resume();
    await refreshDevices();
    setStatus("Pocket TTS loaded. Choose your reference WAV to clone its voice.");
    await cloneReference();
    startRecognition();
  } catch (e) {
    running = false;
    startBtn.disabled = false;
    setStatus(`Start error: ${e.message || e}`);
  }
});

stopBtn.addEventListener("click", async () => {
  running = false;
  clearTimeout(silenceTimer);
  finalText = "";
  generationId++;
  try { recognition?.stop(); } catch {}
  try { await tts?.stop(); } catch {}
  try { player?.stop(); } catch {}
  setStatus("Stopped.");
  startBtn.disabled = false;
});

navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
refreshDevices();
