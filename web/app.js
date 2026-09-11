import { VoxShot, WorkerSynthesisEngine } from 'voxshot';

const $ = id => document.getElementById(id);
const status = $('status'), modelState = $('modelState'), cloneStatus = $('cloneStatus');
const voiceFile = $('voiceFile'), backend = $('backend'), inputDevice = $('inputDevice'), outputDevice = $('outputDevice');
const routingStatus = $('routingStatus'), text = $('text'), test = $('test'), startBtn = $('start'), stopBtn = $('stop');
const transcript = $('transcript'), meter = $('meterFill'), player = $('player');

let tts = null;
let workerEngine = null;
let worker = null;
let cloned = false;
let selectedOutput = 'default';
let recognition = null;
let micStream = null;
let listening = false;
let restarting = false;
let queue = [];
let queueRunning = false;
let modelPromise = null;

function setStatus(message, kind = '') {
  status.textContent = message;
  status.className = `status ${kind}`;
}
function setClone(message) { cloneStatus.textContent = message; }
function fail(error) {
  const message = error?.message || String(error);
  setStatus(message, 'err');
  transcript.textContent = message;
}

function progress(event) {
  if (!event) return;
  if (event.status === 'load-ready') {
    modelState.textContent = event.plan || 'ready';
  } else if (event.status === 'load-fallback') {
    modelState.textContent = 'fallback';
  } else if (event.status === 'load-compiling') {
    modelState.textContent = 'initializing';
  }
}

async function loadModel() {
  if (tts) return tts;
  if (modelPromise) return modelPromise;

  modelPromise = (async () => {
    // All Chatterbox/ONNX work lives in a dedicated worker so model loading,
    // compilation and synthesis cannot freeze the page or microphone controls.
    worker = new Worker('/tts.worker.js', { type: 'module' });
    workerEngine = new WorkerSynthesisEngine(worker, { onProgress: progress });

    const mode = backend.value || 'wasm';
    tts = await VoxShot.create({
      engine: workerEngine,
      device: mode,
      minChunkLength: 20
    });

    modelState.textContent = tts.device || mode;
    setStatus('Chatterbox ready.', 'ok');
    return tts;
  })().catch(error => {
    modelPromise = null;
    tts = null;
    workerEngine = null;
    if (worker) {
      try { worker.terminate(); } catch {}
      worker = null;
    }
    fail(error);
    throw error;
  });

  return modelPromise;
}

async function cloneVoice() {
  try {
    const file = voiceFile.files?.[0];
    if (!file) throw new Error('Choose a reference recording first.');
    if (file.size < 10000) throw new Error('Reference recording is too small.');
    await loadModel();
    cloned = false;
    setStatus('Creating voice clone locally…');
    await tts.cloneVoice(file);
    await tts.saveVoice('my-voice').catch(() => {});
    cloned = true;
    setClone('Voice clone ready.');
    setStatus('Voice clone ready.', 'ok');
  } catch (error) {
    cloned = false;
    setClone(`Clone error: ${error?.message || error}`);
    fail(error);
  }
}

async function playAudio(audio) {
  if (selectedOutput !== 'default' && player.setSinkId) {
    await player.setSinkId(selectedOutput);
    player.src = URL.createObjectURL(audio.toBlob());
    try {
      await player.play();
      await new Promise(resolve => {
        const done = () => { player.removeEventListener('ended', done); resolve(); };
        player.addEventListener('ended', done);
      });
    } finally {
      URL.revokeObjectURL(player.src);
    }
  } else {
    await audio.play();
  }
}

async function speak(value) {
  if (!value.trim()) return;
  if (!cloned) throw new Error('Clone your voice first.');
  await loadModel();
  meter.style.width = '70%';
  try {
    for await (const chunk of tts.stream(value.trim().slice(0, 160))) {
      await playAudio(chunk);
    }
  } finally {
    meter.style.width = '0%';
  }
}

async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (queue.length) {
      const phrase = queue.shift();
      try {
        setStatus('Speaking cloned voice…');
        await speak(phrase);
      } catch (error) {
        fail(error);
      }
    }
  } finally {
    queueRunning = false;
    if (listening) setStatus('Listening continuously.', 'ok');
  }
}

function enqueue(value) {
  const phrase = value.trim();
  if (!phrase) return;
  queue.push(phrase);
  processQueue();
}

async function openMic() {
  if (micStream) return;
  const audio = inputDevice.value
    ? { deviceId: { exact: inputDevice.value }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  micStream = await navigator.mediaDevices.getUserMedia({ audio });
}

function makeRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const r = new SpeechRecognition();
  r.lang = 'en-US';
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.onstart = () => {
    restarting = false;
    startBtn.textContent = 'Listening continuously…';
    setStatus('Listening continuously.', 'ok');
  };
  r.onresult = event => {
    let finalText = '';
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const phrase = event.results[i][0]?.transcript || '';
      if (event.results[i].isFinal) finalText += phrase;
      else interim += phrase;
    }
    if (finalText.trim()) {
      transcript.textContent = finalText.trim();
      enqueue(finalText);
    } else if (interim.trim()) {
      transcript.textContent = interim.trim();
    }
  };
  r.onerror = event => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      listening = false;
      setStatus('Microphone permission denied. Allow this site to use the microphone.', 'err');
    } else if (event.error !== 'aborted') {
      setStatus(`Speech recognition: ${event.error}`, 'err');
    }
  };
  r.onend = () => {
    if (!listening || restarting) return;
    restarting = true;
    setTimeout(() => {
      if (!listening) return;
      try { r.start(); }
      catch { restarting = false; setTimeout(() => { if (listening) try { r.start(); } catch {} }, 500); }
    }, 150);
  };
  return r;
}

async function startListening() {
  try {
    if (!cloned) throw new Error('Clone your voice first.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is unavailable.');
    await openMic();
    listening = true;
    if (!recognition) recognition = makeRecognition();
    if (!recognition) throw new Error('Chrome or Edge speech recognition is required.');
    try { recognition.start(); } catch (error) { if (!String(error).includes('InvalidStateError')) throw error; }
    startBtn.textContent = 'Listening continuously…';
  } catch (error) {
    fail(error);
  }
}

function stopListening() {
  listening = false;
  restarting = false;
  queue = [];
  if (recognition) try { recognition.abort(); } catch {}
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  startBtn.textContent = 'Start continuous listening';
  meter.style.width = '0%';
  setStatus(cloned ? 'Voice clone ready.' : 'Ready.');
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  inputDevice.innerHTML = '<option value="">Default microphone</option>';
  outputDevice.innerHTML = '<option value="default">Default Windows output</option>';
  for (const device of devices) {
    if (device.kind === 'audioinput' && device.deviceId) inputDevice.add(new Option(device.label || 'Microphone', device.deviceId));
    if (device.kind === 'audiooutput' && device.deviceId) {
      const label = /cable input|vb-audio cable|virtual audio cable/i.test(device.label || '') ? 'VB-CABLE — CABLE Input' : (device.label || 'Audio output');
      outputDevice.add(new Option(label, device.deviceId));
    }
  }
  routingStatus.textContent = `TTS output → ${outputDevice.selectedOptions[0]?.text || 'Default Windows output'}. ChilloutVR microphone → CABLE Output.`;
}

voiceFile.addEventListener('change', () => setClone(voiceFile.files?.[0] ? `Selected: ${voiceFile.files[0].name}` : 'No voice loaded.'));
$('clone').onclick = cloneVoice;
$('clearVoice').onclick = () => { cloned = false; voiceFile.value = ''; setClone('No voice loaded.'); setStatus('Voice clone cleared.'); };
test.onclick = async () => { try { setStatus('Generating cloned test voice…'); await speak(text.value); setStatus('Test complete.', 'ok'); } catch (error) { fail(error); } };
startBtn.onclick = startListening;
stopBtn.onclick = stopListening;
$('refreshDevices').onclick = () => refreshDevices().catch(fail);
$('chooseOutput').onclick = async () => {
  try {
    if (!navigator.mediaDevices?.selectAudioOutput) throw new Error('Chrome did not expose the output-device picker. Use the output list instead.');
    const device = await navigator.mediaDevices.selectAudioOutput();
    if (device?.deviceId) { selectedOutput = device.deviceId; await refreshDevices(); outputDevice.value = device.deviceId; }
  } catch (error) { fail(error); }
};
outputDevice.onchange = () => { selectedOutput = outputDevice.value || 'default'; };
backend.onchange = () => { if (tts) setStatus('Backend changed. Reload the page to use the new backend.'); };
window.addEventListener('error', event => fail(event.error || new Error(event.message)));
window.addEventListener('unhandledrejection', event => fail(event.reason || new Error('Unknown error')));
refreshDevices().catch(() => {});

// Start the model immediately, but do it in the worker so the page remains responsive.
loadModel().catch(() => {});

window.addEventListener('beforeunload', () => {
  try { worker?.terminate(); } catch {}
});
