import { pipeline, env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";

const $ = id => document.getElementById(id);
let stt = null, tts = null, loaded = false, listening = false, busy = false;
let lastText = "", stream = null, ctx = null, source = null, processor = null, muteNode = null;
let frameBuffer = [], preRoll = [], speakingFrames = [], speechActive = false, quietFrames = 0, segmentBusy = false;
let inputRate = 48000, lastInferenceAt = 0, micPermissionRequested = false;

function status(s) { $("status").textContent = s; }
function state(s) { $("state").textContent = s; }
function progress(p) { $("progressbar").style.width = Math.max(0, Math.min(100, p)) + "%"; }

async function refreshMics() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());
    micPermissionRequested = true;
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
  } catch (e) {
    status("Microphone permission: " + e.message);
  }
}

async function loadModels() {
  $("load").disabled = true;
  state("Loading");
  status("Loading Whisper. The first launch downloads model files.");
  progress(2);
  try {
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const wantGpu = $("gpu").checked;
    const model = $("asr").value;
    try {
      stt = await pipeline("automatic-speech-recognition", model, {
        device: wantGpu ? "webgpu" : "wasm",
        dtype: wantGpu ? "fp32" : "q8",
        progress_callback: p => {
          if (typeof p.progress === "number") progress(Math.max(2, Math.min(48, p.progress * 0.48)));
          if (p.status === "downloading") status("Downloading Whisper model files…");
        }
      });
      $("engine").textContent = "Whisper: " + (wantGpu ? "WebGPU" : "WASM");
    } catch (e) {
      if (!wantGpu) throw e;
      console.warn("Whisper WebGPU unavailable; using WASM", e);
      status("Whisper WebGPU unavailable; switching to WASM…");
      stt = await pipeline("automatic-speech-recognition", model, { device: "wasm", dtype: "q8" });
      $("engine").textContent = "Whisper: WASM fallback";
    }

    status("Loading Kokoro speech model…");
    progress(52);
    try {
      tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        device: wantGpu ? "webgpu" : "wasm",
        dtype: wantGpu ? "fp32" : "q8"
      });
      $("engine").textContent += " · Kokoro: " + (wantGpu ? "WebGPU" : "WASM");
    } catch (e) {
      if (!wantGpu) throw e;
      console.warn("Kokoro WebGPU unavailable; using WASM", e);
      status("Kokoro WebGPU unavailable; switching to WASM…");
      tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { device: "wasm", dtype: "q8" });
      $("engine").textContent += " · Kokoro: WASM fallback";
    }

    loaded = true;
    progress(100);
    state("Ready");
    status("Models loaded. Press Start listening and speak clearly, then pause.");
    $("start").disabled = false;
    $("repeat").disabled = !lastText;
    $("asr").disabled = true;
    $("gpu").disabled = true;
  } catch (e) {
    console.error(e);
    state("Load failed");
    status("Could not load models: " + (e?.message || String(e)));
    $("load").disabled = false;
    progress(0);
  }
}

async function startListening() {
  if (!loaded || listening) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: $("mic").value ? { exact: $("mic").value } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    });
    ctx = new AudioContext();
    await ctx.resume();
    inputRate = ctx.sampleRate;
    source = ctx.createMediaStreamSource(stream);

    // PCM capture avoids the broken/partial WebM fragments produced by
    // cutting a MediaRecorder stream into arbitrary silence-delimited blobs.
    processor = ctx.createScriptProcessor(4096, 1, 1);
    muteNode = ctx.createGain();
    muteNode.gain.value = 0;
    source.connect(processor);
    processor.connect(muteNode);
    muteNode.connect(ctx.destination);
    processor.onaudioprocess = onAudioFrame;

    resetSegmenter();
    listening = true;
    $("start").disabled = true;
    $("stop").disabled = false;
    $("mic").disabled = true;
    state("Listening");
    status("Listening — speak clearly, then pause briefly. Only captured speech is sent to Whisper.");
  } catch (e) {
    console.error(e);
    status("Microphone error: " + (e?.message || String(e)));
    stopListening();
  }
}

function resetSegmenter() {
  frameBuffer = [];
  preRoll = [];
  speakingFrames = [];
  speechActive = false;
  quietFrames = 0;
  segmentBusy = false;
}

function rmsOf(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function onAudioFrame(event) {
  if (!listening || busy || !stt) return;
  const input = event.inputBuffer.getChannelData(0);
  const frame = new Float32Array(input);
  const rms = rmsOf(frame);
  $("levelbar").style.width = Math.min(100, rms * 650) + "%";
  $("level").textContent = "Microphone level: " + Math.round(rms * 100) + "%";

  // 40–90 ms of pre-roll preserves the beginning of words.
  preRoll.push(frame);
  if (preRoll.length > 3) preRoll.shift();

  const threshold = 0.012;
  if (rms >= threshold) {
    if (!speechActive) {
      speechActive = true;
      speakingFrames = preRoll.slice();
      quietFrames = 0;
      status("Speech detected…");
    }
    speakingFrames.push(frame);
    quietFrames = 0;
    // Safety cap: force a segment at ~14 seconds to avoid unbounded buffers.
    if (speakingFrames.length * frame.length / inputRate >= 14) finishSegment();
  } else if (speechActive) {
    speakingFrames.push(frame);
    quietFrames++;
    // ScriptProcessor runs every 4096 samples; 5 quiet frames is about 0.45s
    // at 44.1 kHz and is enough to split phrases without sending long silence.
    if (quietFrames >= 5) finishSegment();
  }
}

function finishSegment() {
  if (!speechActive || segmentBusy) return;
  speechActive = false;
  quietFrames = 0;
  const frames = speakingFrames;
  speakingFrames = [];
  preRoll = [];
  const length = frames.reduce((n, f) => n + f.length, 0);
  const duration = length / inputRate;
  if (duration < 0.35) return; // ignore clicks and very short noise bursts
  const pcm = new Float32Array(length);
  let offset = 0;
  for (const f of frames) { pcm.set(f, offset); offset += f.length; }
  segmentBusy = true;
  transcribePcm(pcm).catch(e => {
    console.error(e);
    status("Transcription failed: " + (e?.message || String(e)));
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
  // Averaging each source interval reduces aliasing better than selecting
  // individual samples and is sufficient for speech input.
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

async function transcribePcm(pcm) {
  if (!stt || !listening) return;
  const samples = resample(pcm, inputRate, 16000);
  const duration = samples.length / 16000;
  if (duration < 0.35 || rmsOf(samples) < 0.006) return;
  status("Transcribing captured speech locally…");
  // Do not decode a partial MediaRecorder/WebM blob. Whisper receives a clean
  // mono Float32Array sampled at exactly 16 kHz.
  const result = await stt(samples, {
    sampling_rate: 16000,
    chunk_length_s: 0,
    stride_length_s: 0
  });
  let text = (typeof result?.text === "string" ? result.text : "").trim();
  text = text.replace(/\s+/g, " ");
  if (!text || /^[.,!?…\s]+$/.test(text)) return;

  // Prevent Whisper from inventing a sentence from near-silence.
  if (rmsOf(samples) < 0.009 && duration < 1.1) {
    status("Ignored a quiet/noisy segment; keep the microphone closer and try again.");
    return;
  }

  lastText = text;
  $("transcript").textContent = text;
  $("repeat").disabled = false;
  if ($("auto").checked) await speak(text);
}

function wavBlob(samples, rate) {
  const data = samples instanceof Float32Array ? samples : new Float32Array(samples);
  const buffer = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(buffer);
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
  busy = true;
  state("Speaking");
  status("Generating Kokoro speech…");
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
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    console.error(e);
    status("Kokoro TTS failed: " + (e?.message || String(e)));
  } finally {
    busy = false;
    if (resume && $("pause").checked) resumeCapture();
    else if (listening) { state("Listening"); status("Listening — speak clearly, then pause briefly."); }
    else { state("Ready"); status("Ready."); }
  }
}

function disconnectAudio() {
  if (processor) {
    processor.onaudioprocess = null;
    try { processor.disconnect(); } catch {}
    processor = null;
  }
  if (source) { try { source.disconnect(); } catch {} source = null; }
  if (muteNode) { try { muteNode.disconnect(); } catch {} muteNode = null; }
}

function pauseCapture() {
  listening = false;
  disconnectAudio();
  if (ctx) { const old = ctx; ctx = null; old.close().catch(() => {}); }
}

async function resumeCapture() {
  if (!stream || !loaded) return;
  try {
    ctx = new AudioContext();
    await ctx.resume();
    inputRate = ctx.sampleRate;
    source = ctx.createMediaStreamSource(stream);
    processor = ctx.createScriptProcessor(4096, 1, 1);
    muteNode = ctx.createGain();
    muteNode.gain.value = 0;
    source.connect(processor); processor.connect(muteNode); muteNode.connect(ctx.destination);
    processor.onaudioprocess = onAudioFrame;
    resetSegmenter();
    listening = true;
    state("Listening");
    status("Listening — speak clearly, then pause briefly.");
  } catch (e) {
    status("Could not resume microphone: " + e.message);
    stopListening();
  }
}

function stopListening() {
  listening = false;
  disconnectAudio();
  if (ctx) { const old = ctx; ctx = null; old.close().catch(() => {}); }
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  resetSegmenter();
  $("start").disabled = !loaded;
  $("stop").disabled = true;
  $("mic").disabled = false;
  state(loaded ? "Ready" : "Stopped");
  status("Listening stopped.");
}

$("load").addEventListener("click", loadModels);
$("start").addEventListener("click", startListening);
$("stop").addEventListener("click", stopListening);
$("repeat").addEventListener("click", () => lastText ? speak(lastText) : status("Nothing to repeat yet."));
navigator.mediaDevices?.addEventListener?.("devicechange", refreshMics);
refreshMics();
