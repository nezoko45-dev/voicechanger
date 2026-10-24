// Chrome captures audio through AudioWorklet; the local EXE transcribes and compares it.
// Audio clips are sent only to 127.0.0.1. No audio is uploaded to a cloud service.
let micStream, tabStream, micContext, tabContext, micRecorder, tabRecorder;
let queue = Promise.resolve();
let latestUserClip = null;
let activePlayback = null;

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
  // Buffer ChatGPT audio instead of playing it immediately. After local transcription,
  // we play the original clip on a match or substitute the user's captured mic clip
  // on a mismatch. This adds a phrase-sized delay but avoids refreshing the chat.
  tabContext = new AudioContext();
  micContext = new AudioContext();
  await Promise.all([
    micContext.audioWorklet.addModule(chrome.runtime.getURL("audio-worklet.js")),
    tabContext.audioWorklet.addModule(chrome.runtime.getURL("audio-worklet.js"))
  ]);
  micRecorder = makeSegmenter(micContext, micStream, "user");
  tabRecorder = makeSegmenter(tabContext, tabStream, "assistant");
  await Promise.all([micContext.resume(), tabContext.resume()]);
  status("Live transcript helper active: Voice Mode audio stays live; local words appear in an on-page correction panel.");
}

function makeSegmenter(context, stream, role) {
  const source = context.createMediaStreamSource(stream);
  const processor = new AudioWorkletNode(context, "echo-guard-capture", {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
  });
  const mute = context.createGain();
  // Tab audio must remain audible; mic capture stays muted to prevent feedback.
  mute.gain.value = role === "assistant" ? 1 : 0;
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
        if (role === "user") latestUserClip = { frames: saved, sampleRate, at: Date.now(), text: "" };
        queue = queue.then(async () => {
          const result = await transcribe(saved, sampleRate, role);
          if (role === "user" && result?.text && latestUserClip?.at) {
            latestUserClip.text = result.text;
            latestUserClip.transcribedAt = Date.now();
          }
          if (role === "assistant") {
            // Assistant audio is already playing live through the AudioWorklet.
            // Keep transcript comparison informational; never buffer or substitute speech.
            if (result?.text) chrome.runtime.sendMessage({
              type: "ECHO_ASSISTANT_TRANSCRIPT",
              text: result.text,
              status: result.status || "unknown",
              user: result.user || "",
              assistant: result.assistant || ""
            }).catch(() => {});
          }
        }).catch(error => status("Transcription error: " + error.message));
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
  if (role === "user" && result.text) {
    status("Local transcript: " + result.text);
    chrome.runtime.sendMessage({ type: "ECHO_LOCAL_TRANSCRIPT", text: result.text, at: Date.now() }).catch(() => {});
  }
  if (role !== "assistant" || !result.text) return result;
  if (result.status === "waiting") {
    status("ChatGPT audio buffered; no recent mic phrase to compare, so the original audio will play.");
  } else if (result.status === "match") {
    chrome.runtime.sendMessage({ type: "ECHO_AUDIO_STATUS", status: "match", detail: { user: result.user, assistant: result.assistant } }).catch(() => {});
  } else if (result.status === "mismatch") {
    chrome.runtime.sendMessage({ type: "ECHO_AUDIO_STATUS", status: "mismatch", detail: { user: result.user, assistant: result.assistant } }).catch(() => {});
  }
  return result;
}

async function playFrames(frames, sourceRate, context) {
  if (!context || context.state === "closed") return;
  const sourceLength = frames.reduce((sum, frame) => sum + frame.length, 0);
  if (!sourceLength) return;
  const source = new Float32Array(sourceLength);
  let offset = 0;
  for (const frame of frames) { source.set(frame, offset); offset += frame.length; }
  let samples = source;
  if (sourceRate !== context.sampleRate) {
    const targetLength = Math.max(1, Math.floor(source.length * context.sampleRate / sourceRate));
    samples = new Float32Array(targetLength);
    const ratio = sourceRate / context.sampleRate;
    for (let i = 0; i < targetLength; i++) {
      const p = i * ratio, left = Math.floor(p), right = Math.min(left + 1, source.length - 1);
      samples[i] = source[left] * (1 - (p - left)) + source[right] * (p - left);
    }
  }
  if (activePlayback) {
    try { activePlayback.stop(); } catch {}
    activePlayback = null;
  }
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.copyToChannel(samples, 0);
  const player = context.createBufferSource();
  player.buffer = buffer;
  player.connect(context.destination);
  activePlayback = player;
  player.onended = () => { if (activePlayback === player) activePlayback = null; player.disconnect(); };
  await context.resume();
  player.start();
  await new Promise(resolve => { player.onended = () => { if (activePlayback === player) activePlayback = null; player.disconnect(); resolve(); }; });
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
  if (activePlayback) { try { activePlayback.stop(); } catch {} activePlayback = null; }
  latestUserClip = null;
  micStream = tabStream = micContext = tabContext = micRecorder = tabRecorder = null;
  queue = Promise.resolve();
}
