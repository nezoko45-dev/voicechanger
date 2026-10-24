// Audio stays in this offscreen extension document; only WAV bytes are sent to
// the user's local Whisper service at 127.0.0.1.
let micStream, tabStream, micContext, tabContext, micRecorder, tabRecorder;
let lastUserText = "";
let lastUserAt = 0;
let busy = false;
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
  micRecorder = makeSegmenter(micContext, micStream, "user");
  tabRecorder = makeSegmenter(tabContext, tabStream, "assistant");
  await Promise.all([micContext.resume(), tabContext.resume()]);
  status("Capturing mic + ChatGPT audio. Transcription stays local.");
}

function makeSegmenter(context, stream, role) {
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  let frames = [], sampleCount = 0, speechStartedAt = 0, lastLoudAt = 0, recording = false;
  const sampleRate = context.sampleRate;
  processor.onaudioprocess = event => {
    const input = event.inputBuffer.getChannelData(0);
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
  busy = true;
  try {
    const wav = encodeWav(frames, sampleRate);
    const response = await fetch("http://127.0.0.1:8765/transcribe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: bytesToBase64(wav), sample_rate: sampleRate })
    });
    if (!response.ok) throw new Error("Local Whisper server returned HTTP " + response.status + ". Is local-transcriber running?");
    const result = await response.json(), text = normalize(result.text || "");
    if (!text) return;
    if (role === "user") {
      lastUserText = text; lastUserAt = Date.now();
      status("Heard you: " + text);
      return;
    }
    status("ChatGPT said: " + text);
    if (!lastUserText || Date.now() - lastUserAt > 45000) {
      status("ChatGPT audio heard; waiting for your next utterance.");
      return;
    }
    const same = text === lastUserText;
    chrome.runtime.sendMessage({
      type: "ECHO_AUDIO_STATUS", status: same ? "match" : "mismatch",
      detail: { user: lastUserText, assistant: text }
    }).catch(() => {});
    if (!same) {
      status("Mismatch detected — opening a new chat.");
      chrome.runtime.sendMessage({ type: "ECHO_AUDIO_MISMATCH", user: lastUserText, assistant: text }).catch(() => {});
      lastUserText = "";
    } else {
      status("Exact spoken-word match.");
      lastUserText = "";
    }
  } finally { busy = false; }
}

function normalize(value) {
  return String(value).toLocaleLowerCase().normalize("NFKD")
    .replace(/[’']/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ").trim();
}

function encodeWav(frames, sampleRate) {
  const length = frames.reduce((sum, frame) => sum + frame.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2), view = new DataView(buffer);
  const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + length * 2, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, length * 2, true);
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
  lastUserText = ""; lastUserAt = 0; busy = false; queue = Promise.resolve();
}
