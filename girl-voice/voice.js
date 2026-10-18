const $ = id => document.getElementById(id);
const source = $("source");
const reference = $("reference");
const engine = $("engine");
const quantized = $("quantized");
const convertButton = $("convert");
const status = $("status");
const connection = $("connection");
const fileCount = $("file-count");
const referenceCount = $("reference-count");
const outputs = $("outputs");
const result = $("result");
let backendReady = false;
let isConverting = false;
const outputUrls = [];

function setStatus(message) { status.textContent = message; }
function updateReady() {
  // Keep the button available once the required files are selected. If the backend
  // is offline, clicking reports that clearly instead of leaving the button greyed out.
  convertButton.disabled = isConverting || !source.files.length || reference.files.length !== 2;
}
function updateFileCount() {
  const count = source.files.length;
  fileCount.textContent = count ? count + " source WAV file" + (count === 1 ? "" : "s") + " selected." : "No source files selected.";
  updateReady();
}
function updateReferenceCount() {
  const count = reference.files.length;
  referenceCount.textContent = count === 2
    ? "2 reference WAV files selected. They will be combined before conversion."
    : "Select exactly 2 reference WAV files (" + count + " selected).";
  referenceCount.style.color = count === 2 ? "#86efac" : "#b7b2c8";
  updateReady();
}
async function checkBackend() {
  try {
    const response = await fetch("http://127.0.0.1:8765/health", {cache:"no-store"});
    if (!response.ok) throw new Error("Backend returned HTTP " + response.status);
    const data = await response.json();
    backendReady = Boolean(data.ok);
    connection.textContent = backendReady ? "● Backend connected at 127.0.0.1:8765" : "Backend responded unexpectedly.";
    connection.style.color = backendReady ? "#86efac" : "#fca5a5";
  } catch {
    backendReady = false;
    connection.textContent = "● Backend offline. Run start-voiceclonnx.bat and keep its window open.";
    connection.style.color = "#fca5a5";
  }
  updateReady();
}
source.addEventListener("change", updateFileCount);
reference.addEventListener("change", updateReferenceCount);

function addOutputRow(file, stateText) {
  const row = document.createElement("div");
  row.className = "file-item";
  const name = document.createElement("div");
  name.className = "file-name";
  name.textContent = file.name;
  const state = document.createElement("div");
  state.className = "file-state";
  state.textContent = stateText;
  row.append(name, state);
  outputs.append(row);
  return {row, state};
}
function safeBaseName(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "converted";
}
async function convertOne(file, referenceFiles, index, total) {
  const row = addOutputRow(file, "Converting " + index + " of " + total + "…");
  try {
    const form = new FormData();
    form.append("source_audio", file, file.name);
    form.append("reference_audio_1", referenceFiles[0], referenceFiles[0].name);
    form.append("reference_audio_2", referenceFiles[1], referenceFiles[1].name);
    form.append("engine", engine.value);
    form.append("quantized", String(quantized.checked));
    const response = await fetch("http://127.0.0.1:8765/convert", {method:"POST", body:form});
    if (!response.ok) {
      let detail = "HTTP " + response.status;
      try { const data = await response.json(); detail = data.detail || detail; } catch {}
      throw new Error(detail);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error("The server returned an empty audio file.");
    const url = URL.createObjectURL(blob);
    outputUrls.push(url);
    const link = document.createElement("a");
    link.className = "download";
    link.href = url;
    link.download = safeBaseName(file.name) + "_converted.wav";
    link.textContent = "Download WAV";
    row.state.textContent = "Complete";
    row.row.append(link);
    result.src = url;
    result.hidden = false;
    return null;
  } catch (error) {
    row.state.textContent = "Failed";
    row.state.style.color = "#fca5a5";
    row.state.title = error.message;
    const detail = document.createElement("div");
    detail.className = "hint";
    detail.textContent = error.message;
    row.row.append(detail);
    return file.name + ": " + error.message;
  }
}
convertButton.addEventListener("click", async () => {
  const files = Array.from(source.files);
  const referenceFiles = Array.from(reference.files);
  if (!files.length || referenceFiles.length !== 2 || isConverting) {
    setStatus("Select at least one source WAV and exactly two reference WAV files first.");
    return;
  }
  if (!backendReady) {
    setStatus("The local backend is not connected yet. Run start-voiceclonnx.bat and keep its terminal window open, then try again.");
    await checkBackend();
    if (!backendReady) return;
  }
  isConverting = true;
  updateReady();
  outputs.replaceChildren();
  result.hidden = true;
  const failures = [];
  try {
    for (let i = 0; i < files.length; i++) {
      setStatus("Combining the two reference WAVs on the local server, then converting file " + (i + 1) + " of " + files.length + ": " + files[i].name + "\nLeave this page open. The first conversion may download model files.");
      const failure = await convertOne(files[i], referenceFiles, i + 1, files.length);
      if (failure) failures.push(failure);
    }
    const succeeded = files.length - failures.length;
    setStatus("Finished: " + succeeded + " of " + files.length + " source file(s) converted using both reference WAVs." +
      (failures.length ? "\nFailed files:\n" + failures.join("\n") : "") +
      "\nUse each Download WAV link below to save the converted files.");
  } catch (error) {
    setStatus("Batch conversion stopped: " + error.message);
  } finally {
    isConverting = false;
    updateReady();
    checkBackend();
  }
});
window.addEventListener("pagehide", () => outputUrls.forEach(url => URL.revokeObjectURL(url)));
checkBackend();
setInterval(checkBackend, 8000);
