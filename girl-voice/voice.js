const $ = id => document.getElementById(id);
const source = $("source");
const reference = $("reference");
const engine = $("engine");
const quantized = $("quantized");
const convertButton = $("convert");
const status = $("status");
const connection = $("connection");
const download = $("download");
const result = $("result");
let outputUrl = null;

async function checkBackend() {
  try {
    const response = await fetch("http://127.0.0.1:8765/health", {cache:"no-store"});
    if (!response.ok) throw new Error("Backend returned HTTP " + response.status);
    const data = await response.json();
    connection.textContent = data.ok ? "● Backend connected at 127.0.0.1:8765" : "Backend responded unexpectedly.";
    connection.style.color = data.ok ? "#86efac" : "#fca5a5";
  } catch {
    connection.textContent = "● Backend offline. Run start-voiceclonnx.bat and keep its window open.";
    connection.style.color = "#fca5a5";
  }
  updateReady();
}
function updateReady() {
  convertButton.disabled = !(source.files.length && reference.files.length);
}
function setStatus(message) { status.textContent = message; }
source.addEventListener("change", updateReady);
reference.addEventListener("change", updateReady);

convertButton.addEventListener("click", async () => {
  if (!source.files[0] || !reference.files[0]) return;
  convertButton.disabled = true;
  download.hidden = true;
  result.hidden = true;
  setStatus("Converting audio. The first run may take longer while VoiceClonNX downloads model files…");
  const form = new FormData();
  form.append("source_audio", source.files[0]);
  form.append("reference_audio", reference.files[0]);
  form.append("engine", engine.value);
  form.append("quantized", String(quantized.checked));
  try {
    const response = await fetch("http://127.0.0.1:8765/convert", {method:"POST", body:form});
    if (!response.ok) {
      let detail = "HTTP " + response.status;
      try { const data = await response.json(); detail = data.detail || detail; } catch {}
      throw new Error(detail);
    }
    const blob = await response.blob();
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);
    download.href = outputUrl;
    download.hidden = false;
    result.src = outputUrl;
    result.hidden = false;
    setStatus("Conversion complete. Preview the result or download the converted WAV.");
  } catch (error) {
    setStatus("Conversion failed: " + error.message + "\nCheck that the backend window is running. The first model download also requires an internet connection.");
  } finally {
    convertButton.disabled = false;
  }
});
window.addEventListener("pagehide", () => { if (outputUrl) URL.revokeObjectURL(outputUrl); });
checkBackend();
setInterval(checkBackend, 8000);
