import { VoxShot, WorkerSynthesisEngine } from 'voxshot';

const $ = id => document.getElementById(id);
const status = $('status');
const cloneStatus = $('cloneStatus');
const voiceFile = $('voiceFile');
const inputDevice = $('inputDevice');
const outputDevice = $('outputDevice');
const routingStatus = $('routingStatus');
const text = $('text');
const player = $('player');
const transcript = $('transcript');
const startBtn = $('start');

let tts = null;
let worker = null;
let workerEngine = null;
let modelPromise = null;
let cloned = false;
let listening = false;
let restarting = false;
let recognition = null;
let micStream = null;
let outputId = 'default';
let speaking = false;
let phraseQueue = [];

function setStatus(message, kind = '') {
  status.textContent = message;
  status.className = `status ${kind}`;
}

function fail(error) {
  const message = error?.message || String(error);
  setStatus(message, 'err');
  transcript.textContent = message;
}

async function loadChatterbox() {
  if (tts) return tts;
  if (modelPromise) return modelPromise;
  if (!navigator.gpu) {
    throw new Error('WebGPU is required for Chatterbox in this app.');
  }

  modelPromise = (async () => {
    worker = new Worker('/tts.worker.js', { type: 'module' });
    workerEngine = new WorkerSynthesisEngine(worker);
    const instance = await VoxShot.create({
      engine: workerEngine,
      device: 'webgpu',
      minChunkLength: 20
    });
    setStatus('Chatterbox ready.', 'ok');
    return instance;
  })().catch(error => {
    try { worker?.terminate(); } catch {}
    worker = null;
    workerEngine = null;
    modelPromise = null;
    throw error;
  });

  tts = await modelPromise;
  return tts;
}

async function cloneWav() {
  try {
    const file = voiceFile.files?.[0];
    if (!file) throw new Error('Choose a WAV file first.');
    if (!/\.wav$/i.test(file.name) && file.type !== 'audio/wav' && file.type !== 'audio/x-wav') {
      throw new Error('Please choose a WAV voice file.');
    }
    if (file.size < 10000) throw new Error('That WAV file is too small to be a useful voice reference.');

    cloned = false;
    cloneStatus.textContent = 'Loading Chatterbox…';
    setStatus('Loading Chatterbox…');
    const engine = await loadChatterbox();

    cloneStatus.textContent = 'Cloning WAV voice locally…';
    await engine.cloneVoice(file);
    cloned = true;
    cloneStatus.textContent = `Voice ready: ${file.name}`;
    setStatus('Voice clone ready.', 'ok');
  } catch (error) {
    cloned = false;
    cloneStatus.textContent = `Clone failed: ${error?.message || error}`;
    fail(error);
  }
}

async function playSynth(audio) {
  if (outputId !== 'default' && player.setSinkId) {
    await player.setSinkId(outputId);
    const url = URL.createObjectURL(audio.toBlob());
    player.src = url;
    try {
      await player.play();
      await new Promise(resolve => player.addEventListener('ended', resolve, { once: true }));
    } finally {
      URL.revokeObjectURL(url);
    }
    return;
  }
  await audio.play();
}

async function speakPhrase(phrase) {
  if (!cloned) return;
  const value = phrase.trim().slice(0, 160);
  if (!value) return;
  const engine = await loadChatterbox();

  speaking = true;
  setStatus('Speaking your cloned voice…');
  for await (const chunk of engine.stream(value)) {
    if (!listening && phraseQueue.length === 0) {
      // Finish the current phrase, but don't start another one after Stop.
    }
    await playSynth(chunk);
  }
  speaking = false;
}

async function drainQueue() {
  if (speaking) return;
  while (phraseQueue.length && listening) {
    const phrase = phraseQueue.shift();
    try {
      await speakPhrase(phrase);
    } catch (error) {
      speaking = false;
      fail(error);
    }
  }
  if (listening) setStatus('Listening — speak naturally.', 'ok');
}

function queuePhrase(value) {
  const phrase = value.trim();
  if (!phrase || !listening) return;
  // Keep echo latency low instead of allowing a long backlog.
  if (phraseQueue.length >= 2) phraseQueue.shift();
  phraseQueue.push(phrase);
  void drainQueue();
}

async function openMic() {
  if (micStream) return;
  const audio = inputDevice.value
    ? { deviceId: { exact: inputDevice.value }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  micStream = await navigator.mediaDevices.getUserMedia({ audio });
}

function createRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const r = new SpeechRecognition();
  r.lang = 'en-US';
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;

  r.onstart = () => {
    restarting = false;
    setStatus('Listening — speak naturally.', 'ok');
  };

  r.onresult = event => {
    let finalText = '';
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const phrase = event.results[i][0]?.transcript || '';
      if (event.results[i].isFinal) finalText += phrase;
      else interimText += phrase;
    }
    if (finalText.trim()) {
      transcript.textContent = finalText.trim();
      queuePhrase(finalText);
    } else if (interimText.trim()) {
      transcript.textContent = interimText.trim();
    }
  };

  r.onerror = event => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      listening = false;
      setStatus('Microphone permission was denied.', 'err');
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
      catch { restarting = false; setTimeout(() => { if (listening) { try { r.start(); } catch {} } }, 500); }
    }, 250);
  };
  return r;
}

async function startEcho() {
  try {
    if (!cloned) throw new Error('Clone the WAV voice first.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is unavailable.');
    if (!recognition) recognition = createRecognition();
    if (!recognition) throw new Error('Chrome or Edge Speech Recognition is required for STT.');

    await openMic();
    listening = true;
    startBtn.textContent = 'Echo is running…';
    try { recognition.start(); } catch (error) {
      if (!String(error).includes('InvalidStateError')) throw error;
    }
  } catch (error) {
    fail(error);
  }
}

function stopEcho() {
  listening = false;
  restarting = false;
  phraseQueue = [];
  try { recognition?.abort(); } catch {}
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  startBtn.textContent = 'Start voice echo';
  setStatus(cloned ? 'Voice clone ready.' : 'Ready.');
}

async function testVoice() {
  try {
    if (!cloned) throw new Error('Clone the WAV voice first.');
    await speakPhrase(text.value);
    if (!listening) setStatus('Test complete.', 'ok');
  } catch (error) {
    fail(error);
  }
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  inputDevice.innerHTML = '<option value="">Default microphone</option>';
  outputDevice.innerHTML = '<option value="default">Default Windows output</option>';
  for (const d of devices) {
    if (d.kind === 'audioinput' && d.deviceId) inputDevice.add(new Option(d.label || 'Microphone', d.deviceId));
    if (d.kind === 'audiooutput' && d.deviceId) {
      const label = /cable input|vb-audio cable|virtual audio cable/i.test(d.label || '') ? 'VB-CABLE — CABLE Input' : (d.label || 'Audio output');
      outputDevice.add(new Option(label, d.deviceId));
    }
  }
  routingStatus.textContent = `Voice output → ${outputDevice.selectedOptions[0]?.text || 'Default Windows output'}.`;
}

voiceFile.addEventListener('change', () => {
  const file = voiceFile.files?.[0];
  cloneStatus.textContent = file ? `Selected: ${file.name}` : 'No voice loaded.';
});

$('clone').onclick = cloneWav;
$('clearVoice').onclick = () => {
  stopEcho();
  cloned = false;
  voiceFile.value = '';
  cloneStatus.textContent = 'No voice loaded.';
  setStatus('Voice clone cleared.');
};
$('start').onclick = startEcho;
$('stop').onclick = stopEcho;
$('test').onclick = testVoice;
$('refreshDevices').onclick = () => refreshDevices().catch(fail);

$('chooseOutput').onclick = async () => {
  try {
    if (!navigator.mediaDevices?.selectAudioOutput) throw new Error('Output picker is unavailable. Select an output from the list.');
    const device = await navigator.mediaDevices.selectAudioOutput();
    if (device?.deviceId) {
      outputId = device.deviceId;
      await refreshDevices();
      outputDevice.value = device.deviceId;
    }
  } catch (error) { fail(error); }
};

outputDevice.onchange = () => { outputId = outputDevice.value || 'default'; };
window.addEventListener('error', event => fail(event.error || new Error(event.message)));
window.addEventListener('unhandledrejection', event => fail(event.reason || new Error('Unhandled error')));
refreshDevices().catch(() => {});
window.addEventListener('beforeunload', () => { try { worker?.terminate(); } catch {} });
