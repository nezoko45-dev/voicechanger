import { pipeline, env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";

const $ = id => document.getElementById(id);
let stt = null, tts = null, loaded = false, listening = false, busy = false;
let lastText = "", stream = null, ctx = null, source = null, processor = null, muteNode = null;
let preRoll = [], speakingFrames = [], speechActive = false, quietFrames = 0, segmentBusy = false;
let inputRate = 48000;

function status(s) { $("status").textContent = s; }
function state(s) { $("state").textContent = s; }
function progress(p) { $("progressbar").style.width = Math.max(0, Math.min(100, p)) + "%"; }

async function refreshMics() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const select = $("mic"), old = select.value;
    select.innerHTML = '<option value="">System default</option>';
    devices.filter(d => d.kind === "audioinput").forEach((d, i) => {
      const option = document.createElement("option");
      option.value = d.deviceId;
      option.textContent = d.label || "Microphone " + (i + 1);
      select.appendChild(option);
    });
    if ([...select.options].some(o => o.value === old)) select.value = old;
  } catch (e) { status("Microphone permission: " + e.message); }
}

async function loadModels() {
  $("load").disabled = true; state("Loading");
  status("Loading Whisper model. First launch downloads model files."); progress(2);
  try {
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const wantGpu = $("gpu").checked, model = $("asr").value;
    try {
      stt = await pipeline("automatic-speech-recognition", model, {
        device: wantGpu ? "webgpu" : "wasm",
        dtype: wantGpu ? "fp32" : "q8",
        progress_callback: p => {
          if (typeof p.progress === "number") progress(Math.max(2, Math.min(48, p.progress * .48)));
          if (p.status === "downloading") status("Downloading Whisper model files…");
        }
      });
      $("engine").textContent = "Whisper: " + (wantGpu ? "WebGPU" : "WASM");
    } catch (e) {
      if (!wantGpu) throw e;
      console.warn("Whisper WebGPU failed; using WASM", e);
      status("Whisper WebGPU unavailable; switching to WASM…");
      stt = await pipeline("automatic-speech-recognition", model, { device: "wasm", dtype: "q8" });
      $("engine").textContent = "Whisper: WASM fallback";
    }
    status("Loading Kokoro speech model…"); progress(52);
    try {
      tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        device: wantGpu ? "webgpu" : "wasm", dtype: wantGpu ? "fp32" : "q8"
      });
      $("engine").textContent += " · Kokoro: " + (wantGpu ? "WebGPU" : "WASM");
    } catch (e) {
      if (!wantGpu) throw e;
      console.warn("Kokoro WebGPU failed; using WASM", e);
      status("Kokoro WebGPU unavailable; switching to WASM…");
      tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { device: "wasm", dtype: "q8" });
      $("engine").textContent += " · Kokoro: WASM fallback";
    }
    loaded = true; progress(100); state("Ready");
    status("Models loaded. Press Start listening, speak clearly, then pause.");
    $("start").disabled = false; $("repeat").disabled = !lastText;
    $("asr").disabled = true; $("gpu").disabled = true;
  } catch (e) {
    console.error(e); state("Load failed");
    status("Could not load models: " + (e?.message || String(e)));
    $("load").disabled = false; progress(0);
  }
}

async function startListening() {
  if (!loaded || listening) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: $("mic").value ? { exact: $("mic").value } : undefined,
        echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1
      }
    });
    await attachCapture();
    listening = true;
    $("start").disabled = true; $("stop").disabled = false; $("mic").disabled = true;
    state("Listening"); status("Listening — speak clearly, then pause briefly.");
  } catch (e) {
    console.error(e); status("Microphone error: " + (e?.message || String(e)));
    stopListening();
  }
}

async function attachCapture() {
  ctx = new AudioContext();
  await ctx.resume();
  inputRate = ctx.sampleRate;
  source = ctx.createMediaStreamSource(stream);
  // Raw PCM is segmented before transcription; never pass incomplete WebM
  // fragments to Whisper.
  processor = ctx.createScriptProcessor(4096, 1, 1);
  muteNode = ctx.createGain(); muteNode.gain.value = 0;
  source.connect(processor); processor.connect(muteNode); muteNode.connect(ctx.destination);
  processor.onaudioprocess = onAudioFrame;
  resetSegmenter();
}

function resetSegmenter() {
  preRoll = []; speakingFrames = []; speechActive = false; quietFrames = 0;
}
function rmsOf(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function onAudioFrame(event) {
  if (!listening || busy || segmentBusy || !stt) return;
  const frame = new Float32Array(event.inputBuffer.getChannelData(0));
  const rms = rmsOf(frame);
  $("levelbar").style.width = Math.min(100, rms * 650) + "%";
  $("level").textContent = "Microphone level: " + Math.round(rms * 100) + "%";

  preRoll.push(frame);
  if (preRoll.length > 3) preRoll.shift();

  // Raise this slightly if the mic is picking up fans or room noise.
  const threshold = 0.014;
  if (rms >= threshold) {
    if (!speechActive) {
      speechActive = true;
      speakingFrames = preRoll.slice();
      quietFrames = 0;
      status("Speech detected…");
    }
    speakingFrames.push(frame);
    quietFrames = 0;
    if (speakingFrames.length * frame.length / inputRate >= 12) finishSegment();
  } else if (speechActive) {
    speakingFrames.push(frame);
    quietFrames++;
    // 5 frames is about 0.45 seconds at common Windows audio rates.
    if (quietFrames >= 5) finishSegment();
  }
}

function finishSegment() {
  if (!speechActive || segmentBusy) return;
  speechActive = false;
  quietFrames = 0;
  const frames = speakingFrames;
  speakingFrames = []; preRoll = [];
  const length = frames.reduce((n, f) => n + f.length, 0);
  const duration = length / inputRate;
  if (duration < 0.45) return;
  const pcm = new Float32Array(length);
  let offset = 0;
  for (const frame of frames) { pcm.set(frame, offset); offset += frame.length; }
  segmentBusy = true;
  transcribePcm(pcm).catch(e => {
    console.error(e); status("Transcription failed: " + (e?.message || String(e)));
  }).finally(() => {
    segmentBusy = false;
    if (listening && !busy) status("Listening — speak clearly, then pause briefly.");
  });
}

function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio), end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

async function transcribePcm(pcm) {
  if (!stt || !listening) return;
  const samples = resample(pcm, inputRate, 16000);
  const duration = samples.length / 16000, level = rmsOf(samples);
  if (duration < 0.45 || level < 0.008) {
    status("Ignored a quiet/noise-only segment. Speak closer to the microphone.");
    return;
  }
  status("Transcribing captured speech locally…");
  // Keep the Transformers.js ASR call minimal and pass mono 16 kHz PCM.
  const result = await stt(samples, { sampling_rate: 16000 });
  const text = (typeof result?.text === "string" ? result.text : "").trim().replace(/\s+/g, " ");
  if (!text || /^[.,!?…\s]+$/.test(text)) {
    status("No clear words detected. Please try again.");
    return;
  }
  // Do not speak hallucinated output from a quiet/very short recording.
  if (level < 0.012 && duration < 1.2) {
    status("Ignored a low-volume segment to avoid false transcriptions.");
    return;
  }
  lastText = text;
  $("transcript").textContent = text;
  $("repeat").disabled = false;
  if ($("auto").checked) await speak(text);
}

function wavBlob(samples, rate) {
  const data = samples instanceof Float32Array ? samples : new Float32Array(samples);
  const buffer = new ArrayBuffer(44 + data.length * 2), view = new DataView(buffer);
  const write = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + data.length * 2, true);
  write(8, "WAVE"); write(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function speak(text) {
  if (!tts || !text.trim() || busy) return;
  const resume = listening;
  if ($("pause").checked && listening) pauseCapture();
  busy = true; state("Speaking"); status("Generating Kokoro speech…");
  try {
    const out = await tts.generate(text, { voice: $("voice").value });
    const audio = out?.audio ?? out;
    const rate = out?.sampling_rate ?? out?.sampleRate ?? 24000;
    const url = URL.createObjectURL(wavBlob(audio, rate));
    const player = new Audio(url);
    try {
      await new Promise((resolve, reject) => {
        player.onended = resolve;
        player.onerror = () => reject(new Error("Audio playback failed"));
        player.play().catch(reject);
      });
    } finally { URL.revokeObjectURL(url); }
  } catch (e) {
    console.error(e); status("Kokoro TTS failed: " + (e?.message || String(e)));
  } finally {
    busy = false;
    if (resume && $("pause").checked) await resumeCapture();
    else if (listening) { state("Listening"); status("Listening — speak clearly, then pause briefly."); }
    else { state("Ready"); status("Ready."); }
  }
}

function disconnectAudio() {
  if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch {} processor = null; }
  if (source) { try { source.disconnect(); } catch {} source = null; }
  if (muteNode) { try { muteNode.disconnect(); } catch {} muteNode = null; }
}
function pauseCapture() {
  listening = false; disconnectAudio();
  if (ctx) { const old = ctx; ctx = null; old.close().catch(() => {}); }
}
async function resumeCapture() {
  if (!stream || !loaded) return;
  try {
    await attachCapture(); listening = true;
    state("Listening"); status("Listening — speak clearly, then pause briefly.");
  } catch (e) { status("Could not resume microphone: " + e.message); stopListening(); }
}
function stopListening() {
  listening = false; disconnectAudio();
  if (ctx) { const old = ctx; ctx = null; old.close().catch(() => {}); }
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; resetSegmenter();
  $("start").disabled = !loaded; $("stop").disabled = true; $("mic").disabled = false;
  state(loaded ? "Ready" : "Stopped"); status("Listening stopped.");
}

$("load").addEventListener("click", loadModels);
$("start").addEventListener("click", startListening);
$("stop").addEventListener("click", stopListening);
$("repeat").addEventListener("click", () => lastText ? speak(lastText) : status("Nothing to repeat yet."));
navigator.mediaDevices?.addEventListener?.("devicechange", refreshMics);
refreshMics();
