import { PocketTTS, StreamingPlayer } from "./pocket-tts/index.js";

const status = document.getElementById("status");
const startBtn = document.getElementById("load");
const stopBtn = document.getElementById("stop");
const micSelect = document.getElementById("mic");
const outputSelect = document.getElementById("output");
const meter = document.getElementById("meter");
const silenceSelect = document.getElementById("silence");
const referenceBtn = document.getElementById("reference");

let tts = null;
let player = null;
let clonedVoice = null;
let running = false;
let recognition = null;
let silenceTimer = null;
let pendingText = "";
let generationId = 0;
let referenceFile = null;
let audioStream = null;

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
  } catch (e) {
    setStatus(`Device list unavailable: ${e.message || e}`);
  }
}

async function chooseOutput() {
  if (!outputSelect.value || !player?.audioContext) return;
  const ctx = player.audioContext;
  if (typeof ctx.setSinkId === "function") {
    await ctx.setSinkId(outputSelect.value);
    setStatus("Output selected. Listening…");
  } else {
    setStatus("This Chrome audio path does not expose output selection; using the default speaker.");
  }
}

outputSelect.addEventListener("change", () => chooseOutput().catch(e => setStatus(`Output error: ${e.message || e}`)));

document.getElementById("choose")?.addEventListener("click", () => chooseOutput().catch(e => setStatus(`Output error: ${e.message || e}`)));

referenceBtn.addEventListener("click", () => {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "audio/*,.wav";
  picker.onchange = async () => {
    referenceFile = picker.files?.[0] || null;
    if (!referenceFile) return;
    if (!tts) {
      setStatus("Reference selected. Press START to load Pocket TTS, then it will be cloned automatically.");
      return;
    }
    await loadReference(referenceFile);
  };
  picker.click();
});

async function loadReference(file) {
  setStatus("Encoding your WAV reference…");
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration < 1) throw new Error("The reference is too short. Use at least 1 second of clear speech.");
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
    setStatus("Voice cloned. Speak normally; TTS starts after silence.");
  } finally {
    await ctx.close();
  }
}

async function speak(text) {
  text = text.trim();
  if (!text || !clonedVoice || !tts || !player) return;
  const id = ++generationId;
  try {
    await tts.stop();
    player.reset();
    setStatus(`Speaking: ${text}`);
    await tts.generate(text, {
      voice: clonedVoice,
      onChunk: (audio, meta) => {
        if (id === generationId) player.play(audio, meta);
      }
    });
    if (id === generationId) player.flush();
    setStatus("Listening…");
  } catch (e) {
    if (id === generationId) setStatus(`TTS error: ${e.message || e}`);
  }
}

function scheduleSpeech() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    const text = pendingText.trim();
    pendingText = "";
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
  recognition.onstart = () => setStatus(`Listening… TTS starts after ${silenceMs()} ms of silence.`);
  recognition.onresult = e => {
    let sawSpeech = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r[0]?.transcript) sawSpeech = true;
      if (r.isFinal) pendingText += r[0].transcript + " ";
    }
    if (sawSpeech) {
      meter.style.width = "100%";
      scheduleSpeech();
    }
  };
  recognition.onerror = e => {
    if (e.error !== "aborted") setStatus(`Speech recognition: ${e.error}`);
  };
  recognition.onend = () => {
    if (running) setTimeout(() => {
      try { recognition.start(); } catch {}
    }, 50);
  };
  recognition.start();
}

startBtn.addEventListener("click", async () => {
  if (running) return;
  try {
    running = true;
    startBtn.disabled = true;
    setStatus("Loading Pocket TTS… first load downloads and caches the INT8 model.");

    tts = new PocketTTS({
      language: "english_2026-04",
      quantized: true,
      voiceCloning: true,
      cache: true,
      maxThreads: 1
    });
    await tts.load(p => {
      if (p?.total) meter.style.width = `${Math.min(100, p.loaded / p.total * 100)}%`;
      if (p?.label) setStatus(`${p.label}…`);
    });

    player = new StreamingPlayer({ sampleRate: tts.sampleRate, primeSeconds: 0.12, leadSeconds: 0.02 });
    await player.resume();
    await refreshDevices();
    await chooseOutput().catch(() => {});

    if (!referenceFile) {
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = "audio/*,.wav";
      picker.onchange = async () => {
        referenceFile = picker.files?.[0] || null;
        if (referenceFile) await loadReference(referenceFile);
      };
      picker.click();
    } else {
      await loadReference(referenceFile);
    }

    if (!clonedVoice) throw new Error("Choose a WAV reference before speaking.");
    startRecognition();
  } catch (e) {
    running = false;
    startBtn.disabled = false;
    try { recognition?.stop(); } catch {}
    setStatus(`Start error: ${e.message || e}`);
  }
});

stopBtn.addEventListener("click", async () => {
  running = false;
  clearTimeout(silenceTimer);
  pendingText = "";
  generationId++;
  try { recognition?.stop(); } catch {}
  try { await tts?.stop(); } catch {}
  try { player?.stop(); } catch {}
  if (audioStream) audioStream.getTracks().forEach(t => t.stop());
  setStatus("Stopped.");
  startBtn.disabled = false;
});

micSelect.addEventListener("change", () => {
  // Chrome SpeechRecognition chooses its own input device; the selector is retained
  // for device visibility/compatibility. getUserMedia is used to unlock device labels.
  if (micSelect.value) setStatus("Microphone selected. Chrome SpeechRecognition will use its configured input device.");
});

navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
refreshDevices();
