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
    status("Microphone access failed. Check Chrome's microphone permission.", true);
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
