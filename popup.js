const $ = (id) => document.getElementById(id);
const referenceInput = $("reference");
const recordButton = $("record");
const stopButton = $("stop");
const convertButton = $("convert");
const consent = $("consent");
let referenceFile = null;
let sourceBlob = null;
let mediaRecorder = null;
let stream = null;
let chunks = [];
let startedAt = 0;
let clock = null;

referenceInput.addEventListener("change", () => {
  referenceFile = referenceInput.files?.[0] || null;
  $("referenceName").textContent = referenceFile ? referenceFile.name : "No reference selected";
  updateReady();
});
consent.addEventListener("change", updateReady);

function updateReady() {
  convertButton.disabled = !(referenceFile && sourceBlob && consent.checked);
}
function status(message, error = false) {
  $("message").textContent = message;
  $("message").classList.toggle("error", error);
}
function formatTime(seconds) {
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
}
function wavBlob(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const frames = audioBuffer.length;
  const bytes = new ArrayBuffer(44 + frames * channels * 2);
  const view = new DataView(bytes);
  const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, "RIFF"); view.setUint32(4, 36 + frames * channels * 2, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, frames * channels * 2, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) {
    const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(c)[i]));
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}
recordButton.addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.addEventListener("dataavailable", event => { if (event.data.size) chunks.push(event.data); });
    mediaRecorder.addEventListener("stop", async () => {
      clearInterval(clock);
      try {
        const recorded = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const context = new AudioContext();
        const decoded = await context.decodeAudioData(await recorded.arrayBuffer());
        sourceBlob = wavBlob(decoded);
        await context.close();
        $("sourceName").textContent = "source-recording.wav · created automatically";
        $("sourcePreview").src = URL.createObjectURL(sourceBlob);
        $("sourcePreview").hidden = false;
        $("recordStatus").textContent = "Source recording ready";
        status("Source WAV created. Ready to convert.");
      } catch (err) {
        sourceBlob = null;
        status("Could not decode the recording in this browser. Try recording again.", true);
      } finally {
        stream?.getTracks().forEach(track => track.stop());
        stream = null;
        $("recordDot").classList.remove("live");
        recordButton.disabled = false;
        stopButton.disabled = true;
        updateReady();
      }
    });
    mediaRecorder.start();
    startedAt = Date.now();
    $("recordStatus").textContent = "Recording microphone…";
    $("recordDot").classList.add("live");
    recordButton.disabled = true;
    stopButton.disabled = false;
    status("Recording. Speak naturally, then stop.");
    clock = setInterval(() => { $("duration").textContent = formatTime((Date.now() - startedAt) / 1000); }, 250);
  } catch (err) {
    const reason = err?.name ? `${err.name}: ${err.message || "No details provided."}` : String(err);
    status(`Microphone access failed — ${reason}. Check Chrome microphone settings and your operating-system microphone privacy settings.`, true);
  }
});
stopButton.addEventListener("click", () => {
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
});
convertButton.addEventListener("click", async () => {
  if (!referenceFile || !sourceBlob || !consent.checked) return;
  convertButton.disabled = true;
  $("download").hidden = true;
  status("Converting locally… first use may download ONNX models.");
  try {
    const audioContext = new AudioContext();
    const referenceBuffer = await audioContext.decodeAudioData(await referenceFile.arrayBuffer());
    const referenceWav = wavBlob(referenceBuffer);
    await audioContext.close();
    const form = new FormData();
    form.append("source", sourceBlob, "source-recording.wav");
    form.append("reference", referenceWav, "reference.wav");
    form.append("engine", $("engine").value);
    const response = await fetch("http://127.0.0.1:8765/convert", { method: "POST", body: form });
    if (!response.ok) {
      let detail = "Conversion failed.";
      try { detail = (await response.json()).detail || detail; } catch {}
      throw new Error(detail);
    }
    const result = await response.blob();
    const url = URL.createObjectURL(result);
    const link = $("download");
    link.href = url;
    link.download = "voicechanger-output.wav";
    link.hidden = false;
    link.textContent = "Download converted WAV";
    status("Done! Your converted audio is ready.");
  } catch (err) {
    status(err.message.includes("Failed to fetch") ? "Cannot reach local backend. Start it using the README instructions." : err.message, true);
  } finally {
    updateReady();
  }
});


// Experimental live microphone conversion. The backend converts one 4-second WAV
// chunk at a time; model inference may be slower than real time.
const liveStartButton = $("liveStart");
const liveStopButton = $("liveStop");
let liveActive = false;
let liveReady = false;
let liveBusy = false;
let livePendingChunk = null;
let liveDroppedChunks = 0;
let liveSamples = [];
let liveSampleCount = 0;
let liveChunkTarget = 0;
let liveStream = null;
let liveAudioContext = null;
let liveSocket = null;
let liveSourceNode = null;
let liveProcessorNode = null;
let liveNextPlayTime = 0;

function updateLiveStartState() {
  if (liveStartButton) liveStartButton.disabled = liveActive || !(referenceFile && consent.checked);
}
referenceInput.addEventListener("change", updateLiveStartState);
consent.addEventListener("change", updateLiveStartState);

function monoSamplesToWav(samples, sampleRate) {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const write = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
    offset += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  }
  return btoa(binary);
}

function queueLiveChunk(samples, sampleRate) {
  const chunk = { samples, sampleRate };
  if (liveBusy) {
    livePendingChunk = chunk;
    liveDroppedChunks++;
    $("liveState").textContent = "Live · skipped " + liveDroppedChunks + " chunk(s) to limit delay";
    return;
  }
  sendLiveChunk(chunk);
}

async function sendLiveChunk(chunk) {
  if (!liveActive || !liveReady || !liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;
  liveBusy = true;
  try {
    const wav = monoSamplesToWav(chunk.samples, chunk.sampleRate);
    liveSocket.send(await wav.arrayBuffer());
  } catch (err) {
    liveBusy = false;
    status("Could not send live audio: " + (err.message || err), true);
  }
}

function startLiveCapture() {
  if (!liveActive || !liveReady || !liveStream || !liveAudioContext) return;
  liveSamples = [];
  liveSampleCount = 0;
  liveChunkTarget = Math.floor(liveAudioContext.sampleRate * 4);
  liveSourceNode = liveAudioContext.createMediaStreamSource(liveStream);
  liveProcessorNode = liveAudioContext.createScriptProcessor(4096, 1, 1);
  liveProcessorNode.onaudioprocess = (event) => {
    // Mute the raw microphone monitor to avoid hearing the unconverted voice/feedback.
    event.outputBuffer.getChannelData(0).fill(0);
    if (!liveActive || !liveReady) return;
    const input = event.inputBuffer.getChannelData(0);
    liveSamples.push(new Float32Array(input));
    liveSampleCount += input.length;
    if (liveSampleCount >= liveChunkTarget) {
      const joined = new Float32Array(liveSampleCount);
      let offset = 0;
      for (const part of liveSamples) {
        joined.set(part, offset);
        offset += part.length;
      }
      liveSamples = [];
      liveSampleCount = 0;
      queueLiveChunk(joined, liveAudioContext.sampleRate);
    }
  };
  liveSourceNode.connect(liveProcessorNode);
  liveProcessorNode.connect(liveAudioContext.destination);
  $("liveDot").classList.add("live");
  $("liveState").textContent = "Listening · converting 4-second chunks";
  status("Live conversion is running. Headphones are recommended.");
}

liveStartButton.addEventListener("click", async () => {
  if (!referenceFile || !consent.checked || liveActive) return;
  liveActive = true;
  liveReady = false;
  liveBusy = false;
  livePendingChunk = null;
  liveDroppedChunks = 0;
  liveNextPlayTime = 0;
  liveStartButton.disabled = true;
  liveStopButton.disabled = false;
  $("liveState").textContent = "Requesting microphone…";
  try {
    liveStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    liveAudioContext = new AudioContext();
    await liveAudioContext.resume();
    const referenceBuffer = await liveAudioContext.decodeAudioData(await referenceFile.arrayBuffer());
    const referenceWav = wavBlob(referenceBuffer);
    const referenceBase64 = await blobToBase64(referenceWav);
    liveSocket = new WebSocket("ws://127.0.0.1:8765/live");
    liveSocket.binaryType = "arraybuffer";
    liveSocket.onopen = () => {
      liveSocket.send(JSON.stringify({
        type: "start",
        engine: $("engine").value,
        reference_wav_base64: referenceBase64
      }));
      $("liveState").textContent = "Connected · loading voice model…";
      status("Connected to local backend. First start may load ONNX models.");
    };
    liveSocket.onmessage = async (event) => {
      if (typeof event.data === "string") {
        let message;
        try { message = JSON.parse(event.data); } catch { message = { message: event.data }; }
        if (message.error) {
          status(message.error, true);
          liveBusy = false;
          livePendingChunk = null;
          return;
        }
        if (message.status === "ready") {
          liveReady = true;
          startLiveCapture();
        }
        return;
      }
      try {
        const buffer = await liveAudioContext.decodeAudioData(event.data.slice(0));
        const playback = liveAudioContext.createBufferSource();
        playback.buffer = buffer;
        playback.connect(liveAudioContext.destination);
        const startAt = Math.max(liveAudioContext.currentTime + 0.04, liveNextPlayTime);
        playback.start(startAt);
        liveNextPlayTime = startAt + buffer.duration;
      } catch (err) {
        status("Could not play converted audio: " + (err.message || err), true);
      } finally {
        liveBusy = false;
        if (livePendingChunk && liveActive && liveReady) {
          const pending = livePendingChunk;
          livePendingChunk = null;
          sendLiveChunk(pending);
        }
      }
    };
    liveSocket.onerror = () => {
      if (liveActive) {
        status("Live WebSocket failed. Check that start_backend is running and reload the extension.", true);
        stopLiveConversion(false);
      }
    };
    liveSocket.onclose = () => {
      if (liveActive) {
        status("Live connection closed. Check the local backend.", true);
        stopLiveConversion(false);
      }
    };
  } catch (err) {
    const reason = err && err.name ? err.name + ": " + err.message : String(err);
    await stopLiveConversion(false);
    status("Could not start live conversion — " + reason, true);
  }
});

async function stopLiveConversion(showStatus = true) {
  liveActive = false;
  liveReady = false;
  liveBusy = false;
  livePendingChunk = null;
  if (liveProcessorNode) {
    liveProcessorNode.onaudioprocess = null;
    try { liveProcessorNode.disconnect(); } catch {}
    liveProcessorNode = null;
  }
  if (liveSourceNode) {
    try { liveSourceNode.disconnect(); } catch {}
    liveSourceNode = null;
  }
  if (liveStream) {
    liveStream.getTracks().forEach(track => track.stop());
    liveStream = null;
  }
  const socket = liveSocket;
  liveSocket = null;
  if (socket && socket.readyState < WebSocket.CLOSING) {
    try { socket.close(); } catch {}
  }
  const context = liveAudioContext;
  liveAudioContext = null;
  if (context && context.state !== "closed") {
    try { await context.close(); } catch {}
  }
  liveStartButton.disabled = !(referenceFile && consent.checked);
  liveStopButton.disabled = true;
  $("liveDot").classList.remove("live");
  $("liveState").textContent = "Live conversion stopped";
  if (showStatus) status("Live conversion stopped.");
}
liveStopButton.addEventListener("click", () => stopLiveConversion());
