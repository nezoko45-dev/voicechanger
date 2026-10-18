import SignalsmithStretch from "./SignalsmithStretch.mjs";

const $ = id => document.getElementById(id);
const pitch = $("pitch"), formant = $("formant");
const startButton = $("start"), stopButton = $("stop"), status = $("status");
let context = null, stream = null, source = null, stretch = null, gain = null;

function updateLabels() {
  $("pitchValue").textContent = `${Number(pitch.value) >= 0 ? "+" : ""}${pitch.value} semitones`;
  $("formantValue").textContent = `${Number(formant.value) >= 0 ? "+" : ""}${formant.value} semitones`;
}
function setStatus(message) { status.textContent = message; }
async function applySettings() {
  if (!stretch || !context) return;
  await stretch.schedule({
    output: context.currentTime + Math.max(0.08, await stretch.latency()),
    active: true,
    semitones: Number(pitch.value),
    tonalityHz: 6500,
    formantSemitones: Number(formant.value),
    formantCompensation: true,
    formantBaseHz: 180
  });
}
async function startVoice() {
  startButton.disabled = true;
  setStatus("Requesting microphone access…");
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    context = new AudioContext({ latencyHint: "interactive" });
    await context.resume();
    source = context.createMediaStreamSource(stream);
    stretch = await SignalsmithStretch(context, {numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1]});
    gain = context.createGain();
    gain.gain.value = 0.85;
    source.connect(stretch);
    stretch.connect(gain);
    gain.connect(context.destination);
    await stretch.schedule({
      output: context.currentTime + Math.max(0.08, await stretch.latency()),
      active: true,
      semitones: Number(pitch.value),
      tonalityHz: 6500,
      formantSemitones: Number(formant.value),
      formantCompensation: true,
      formantBaseHz: 180
    });
    startButton.textContent = "Voice is on";
    stopButton.disabled = false;
    pitch.disabled = false;
    formant.disabled = false;
    setStatus("Live voice processing is on. Speak and listen with headphones.");
  } catch (error) {
    await stopVoice(false);
    setStatus(error?.name === "NotAllowedError"
      ? "Microphone permission was denied. Allow microphone access and try again."
      : `Could not start audio: ${error?.message || error}`);
    startButton.disabled = false;
  }
}
async function stopVoice(update = true) {
  if (stream) stream.getTracks().forEach(track => track.stop());
  try { if (context && context.state !== "closed") await context.close(); } catch {}
  stream = null; source = null; stretch = null; gain = null; context = null;
  startButton.disabled = false;
  startButton.textContent = "Start voice";
  stopButton.disabled = true;
  if (update) setStatus("Stopped. Microphone is no longer active.");
}
pitch.addEventListener("input", updateLabels);
formant.addEventListener("input", updateLabels);
pitch.addEventListener("change", () => applySettings().catch(e => setStatus(`Could not update pitch: ${e.message}`)));
formant.addEventListener("change", () => applySettings().catch(e => setStatus(`Could not update formants: ${e.message}`)));
startButton.addEventListener("click", startVoice);
stopButton.addEventListener("click", () => stopVoice());
window.addEventListener("pagehide", () => { if (stream) stream.getTracks().forEach(track => track.stop()); });
updateLabels();
