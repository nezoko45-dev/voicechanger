// Chrome captures audio through AudioWorklet; the local EXE transcribes and compares it.
// Audio clips are sent only to 127.0.0.1. No audio is uploaded to a cloud service.
let micStream, tabStream, micContext, tabContext, micRecorder, tabRecorder;
let queue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ECHO_OFFSCREEN_START") {
    start(message.streamId).then(() => sendResponse({ ok: true }), error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "ECHO_OFFSCREEN_STOP") {
    stop();
    sendResponse({ ok: true });
  }
});

async function start(streamId) {
  stop();
  status("Requesting microphone permission…");
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  tabStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: false
  });
  // tabCapture silences captured tab audio unless it is played back locally.
  tabContext = new AudioContext();
  const tabSource = tabContext.createMediaStreamSource(tabStream);
  tabSource.connect(tabContext.destination);
  micContext = new AudioContext();
  await Promise.all([
    micContext.audioWorklet.addModule(chrome.runtime.getURL("audio-worklet.js")),
    tabContext.audioWorklet.addModule(chrome.runtime.getURL("audio-worklet.js"))
  ]);
  micRecorder = makeSegmenter(micContext, micStream, "user");
  tabRecorder = makeSegmenter(tabContext, tabStream, "assistant");
  await Promise.all([micContext.resume(), tabContext.resume()]);
  status("Capturing mic + ChatGPT audio with AudioWorklet. The local EXE compares recognized words.");
}

function makeSegmenter(context, stream, role) {
  const source = context.createMediaStreamSource(stream);
  const processor = new AudioWorkletNode(context, "echo-guard-capture", {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
  });
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  let frames = [], sampleCount = 0, speechStartedAt = 0, lastLoudAt = 0, recording = false;
  const sampleRate = context.sampleRate;
  processor.port.onmessage = event => {
    const input = event.data?.samples;
    if (!(input instanceof Float32Array)) return;
    let energy = 0;
    for (let i = 0; i < input.length; i++) energy += input[i] * input[i];
    const rms = Math.sqrt(energy / input.length), now = Date.now();
    if (rms > 0.012) {
      lastLoudAt = now;
      if (!recording) { recording = true; speechStartedAt = now; frames = []; sampleCount = 0; }
    }
    if (!recording) return;
    frames.push(new Float32Array(input));
    sampleCount += input.length;
    if (now - speechStartedAt > 14000 || (now - lastLoudAt > 850 && now - speechStartedAt > 450)) {
      const duration = sampleCount / sampleRate, saved = frames;
      recording = false; frames = []; sampleCount = 0;
      if (duration >= 0.45) {
        queue = queue.then(() => transcribe(saved, sampleRate, role)).catch(error => status("Transcription error: " + error.message));
      }
    }
  };
  return { source, processor, mute };
}

async function transcribe(frames, sampleRate, role) {
  const resampled = resampleFrames(frames, sampleRate, 16000);
  const wav = encodeWav([resampled], 16000);
  const response = await fetch("http://127.0.0.1:8765/transcribe", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio: bytesToBase64(wav), sample_rate: 16000, role })
  });
  let result;
  try { result = await response.json(); }
  catch { result = { error: await response.text().catch(() => "") }; }
  if (!response.ok) {
    const detail = result?.error ? ": " + result.error : "";
    throw new Error("EchoGuardTranscriber returned HTTP " + response.status + detail);
  }
  if (result.error) throw new Error(result.error);
  if (role === "user" && result.text) status("Heard you: " + result.text);
  if (role !== "assistant" || !result.text) return;
  if (result.status === "waiting") {
    status("ChatGPT audio heard; waiting for a recent microphone phrase.");
    return;
  }
  if (result.status === "match") {
    status("Exact spoken-word match: " + (result.user || result.text));
    chrome.runtime.sendMessage({ type: "ECHO_AUDIO_STATUS", status: "match", detail: { user: result.user, assistant: result.assistant } }).catch(() => {});
  } else if (result.status === "mismatch") {
    status("Mismatch detected — asking the extension to open a new chat.");
    chrome.runtime.sendMessage({ type: "ECHO_AUDIO_STATUS", status: "mismatch", detail: { user: result.user, assistant: result.assistant } }).catch(() => {});
    chrome.runtime.sendMessage({ type: "ECHO_AUDIO_MISMATCH", user: result.user, assistant: result.assistant }).catch(() => {});
  }
}

function resampleFrames(frames, sourceRate, targetRate) {
  const sourceLength = frames.reduce((sum, frame) => sum + frame.length, 0);
  const source = new Float32Array(sourceLength);
  let cursor = 0;
  for (const frame of frames) { source.set(frame, cursor); cursor += frame.length; }
  if (sourceRate === targetRate) return source;
  const targetLength = Math.max(1, Math.floor(sourceLength * targetRate / sourceRate));
  const target = new Float32Array(targetLength);
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < targetLength; i++) {
    const position = i * ratio;
    const left = Math.floor(position), right = Math.min(left + 1, sourceLength - 1);
    const fraction = position - left;
    target[i] = source[left] * (1 - fraction) + source[right] * fraction;
  }
  return target;
}

function encodeWav(frames, sampleRate) {
  const length = frames.reduce((sum, frame) => sum + frame.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer);
  const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + length * 2, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); write(36, "data");
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const frame of frames) for (let i = 0; i < frame.length; i++) {
    const sample = Math.max(-1, Math.min(1, frame[i]));
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2;
  }
  return new Uint8Array(buffer);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function status(message) {
  chrome.runtime.sendMessage({ type: "ECHO_AUDIO_STATUS", status: "info", detail: message }).catch(() => {});
}
function stop() {
  for (const stream of [micStream, tabStream]) stream?.getTracks().forEach(track => track.stop());
  for (const context of [micContext, tabContext]) if (context && context.state !== "closed") context.close().catch(() => {});
  for (const item of [micRecorder, tabRecorder]) {
    try { item?.processor.disconnect(); item?.source.disconnect(); item?.mute.disconnect(); } catch {}
  }
  micStream = tabStream = micContext = tabContext = micRecorder = tabRecorder = null;
  queue = Promise.resolve();
}
