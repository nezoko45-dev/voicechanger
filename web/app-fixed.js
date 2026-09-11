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

let VoxShot = null;
let WorkerSynthesisEngine = null;
let tts = null;
let worker = null;
let workerEngine = null;
let modelPromise = null;
let cloned = false;
let listening = false;
let restarting = false;
let recognition = null;
let outputId = 'default';
let speaking = false;
let phraseQueue = [];

function setStatus(message, kind = '') {
  status.textContent = message;
  status.className = `status ${kind}`;
}

function fail(error) {
  const message = error?.message || String(error);
  console.error(error);
  setStatus(message, 'err');
  cloneStatus.textContent = message;
}

async function loadVoxShot() {
  if (VoxShot && WorkerSynthesisEngine) return;
  setStatus('Loading VoxShot…');
  const mod = await import('https://esm.sh/gh/m96-chan/voxshot@main');
  VoxShot = mod.VoxShot;
  WorkerSynthesisEngine = mod.WorkerSynthesisEngine;
  if (!VoxShot || !WorkerSynthesisEngine) throw new Error('VoxShot browser API failed to load.');
}

async function loadModel() {
  if (tts) return tts;
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    await loadVoxShot();
    setStatus('Starting Chatterbox…');
    worker = new Worker('/tts.worker.js', { type: 'module' });
    worker.addEventListener('error', e => console.error('Chatterbox worker:', e.error || e.message));
    workerEngine = new WorkerSynthesisEngine(worker);
    tts = await VoxShot.create({ engine: workerEngine, device: 'auto', minChunkLength: 20 });
    setStatus(`Chatterbox ready (${tts.device || 'auto'}).`, 'ok');
    return tts;
  })().catch(error => {
    try { worker?.terminate(); } catch {}
    worker = null;
    workerEngine = null;
    tts = null;
    modelPromise = null;
    throw error;
  });
  return modelPromise;
}

async function cloneWav() {
  try {
    const file = voiceFile.files?.[0];
    if (!file) throw new Error('Choose a WAV file first.');
    if (!/\.wav$/i.test(file.name) && !['audio/wav','audio/x-wav','audio/wave'].includes(file.type)) {
      throw new Error('Please choose a WAV voice file.');
    }
    if (file.size < 10000) throw new Error('That WAV file is too small. Use a clean 5–15 second recording.');
    cloned = false;
    cloneStatus.textContent = 'Loading Chatterbox…';
    setStatus('Loading Chatterbox…');
    const engine = await loadModel();
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
  if (outputId !== 'default' && typeof player.setSinkId === 'function') await player.setSinkId(outputId);
  const url = URL.createObjectURL(audio.toBlob());
  player.src = url;
  try { await player.play(); await new Promise(resolve => player.addEventListener('ended', resolve, { once: true })); }
  finally { URL.revokeObjectURL(url); }
}

async function speakPhrase(phrase) {
  if (!cloned) return;
  const value = phrase.trim().slice(0, 160);
  if (!value) return;
  speaking = true;
  try {
    setStatus('Speaking your cloned voice…');
    const engine = await loadModel();
    for await (const chunk of engine.stream(value)) await playSynth(chunk);
  } finally { speaking = false; }
}

async function drainQueue() {
  if (speaking) return;
  while (phraseQueue.length && listening) {
    const phrase = phraseQueue.shift();
    try { await speakPhrase(phrase); } catch (error) { fail(error); }
  }
  if (listening) setStatus('Listening — speak naturally.', 'ok');
}

function queuePhrase(value) {
  const phrase = value.trim();
  if (!phrase || !listening) return;
  if (phraseQueue.length >= 2) phraseQueue.shift();
  phraseQueue.push(phrase);
  void drainQueue();
}

function createRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const r = new SpeechRecognition();
  r.lang = 'en-US';
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.onstart = () => { restarting = false; setStatus('Listening — speak naturally.', 'ok'); };
  r.onresult = event => {
    let finalText = '', interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const phrase = event.results[i][0]?.transcript || '';
      if (event.results[i].isFinal) finalText += phrase; else interimText += phrase;
    }
    if (finalText.trim()) { transcript.textContent = finalText.trim(); queuePhrase(finalText); }
    else if (interimText.trim()) transcript.textContent = interimText.trim();
  };
  r.onerror = event => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      listening = false;
      setStatus('Microphone or speech-recognition permission was denied.', 'err');
    } else if (event.error !== 'aborted' && event.error !== 'no-speech') setStatus(`Speech recognition: ${event.error}`, 'err');
  };
  r.onend = () => {
    if (!listening || restarting) return;
    restarting = true;
    setTimeout(() => {
      if (!listening) return;
      try { r.start(); }
      catch { restarting = false; setTimeout(() => { if (listening) try { r.start(); } catch {} }, 500); }
    }, 250);
  };
  return r;
}

function startEcho() {
  try {
    if (!cloned) throw new Error('Clone the WAV voice first.');
    recognition ||= createRecognition();
    if (!recognition) throw new Error('Chrome or Edge Speech Recognition is required for STT.');
    listening = true;
    phraseQueue = [];
    transcript.textContent = 'Listening…';
    startBtn.textContent = 'Echo is running…';
    try { recognition.start(); } catch (error) { if (!String(error).includes('InvalidStateError')) throw error; }
  } catch (error) { fail(error); }
}

function stopEcho() {
  listening = false;
  restarting = false;
  phraseQueue = [];
  try { recognition?.abort(); } catch {}
  startBtn.textContent = 'Start voice echo';
  setStatus(cloned ? 'Voice clone ready.' : 'Ready.');
}

async function testVoice() {
  try {
    if (!cloned) throw new Error('Clone the WAV voice first.');
    if (!text.value.trim()) throw new Error('Type something to test the cloned voice.');
    await speakPhrase(text.value);
    if (!listening) setStatus('Test complete.', 'ok');
  } catch (error) { fail(error); }
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const previousOutput = outputId;
  inputDevice.innerHTML = '<option value="">Default microphone</option>';
  outputDevice.innerHTML = '<option value="default">Default Windows output</option>';
  for (const d of devices) {
    if (d.kind === 'audioinput' && d.deviceId) inputDevice.add(new Option(d.label || 'Microphone', d.deviceId));
    if (d.kind === 'audiooutput' && d.deviceId) {
      const label = /cable input|vb-audio cable|virtual audio cable/i.test(d.label || '') ? 'VB-CABLE — CABLE Input' : (d.label || 'Audio output');
      outputDevice.add(new Option(label, d.deviceId));
    }
  }
  if ([...outputDevice.options].some(o => o.value === previousOutput)) outputDevice.value = previousOutput;
  routingStatus.textContent = `Voice output → ${outputDevice.selectedOptions[0]?.text || 'Default Windows output'}.`;
}

voiceFile.addEventListener('change', () => { const f = voiceFile.files?.[0]; cloneStatus.textContent = f ? `Selected: ${f.name}` : 'No voice loaded.'; });
$('clone').addEventListener('click', cloneWav);
$('clearVoice').addEventListener('click', () => { stopEcho(); cloned = false; voiceFile.value = ''; cloneStatus.textContent = 'No voice loaded.'; setStatus('Voice clone cleared.'); });
startBtn.addEventListener('click', startEcho);
$('stop').addEventListener('click', stopEcho);
$('test').addEventListener('click', testVoice);
$('refreshDevices').addEventListener('click', () => refreshDevices().catch(fail));
$('chooseOutput').addEventListener('click', async () => {
  try {
    if (!navigator.mediaDevices?.selectAudioOutput) throw new Error('Output picker is unavailable. Use the Voice output list instead.');
    const d = await navigator.mediaDevices.selectAudioOutput();
    if (d?.deviceId) { outputId = d.deviceId; await refreshDevices(); outputDevice.value = d.deviceId; }
  } catch (error) { fail(error); }
});
outputDevice.addEventListener('change', () => { outputId = outputDevice.value || 'default'; routingStatus.textContent = `Voice output → ${outputDevice.selectedOptions[0]?.text || 'Default Windows output'}.`; });
window.addEventListener('error', e => fail(e.error || new Error(e.message)));
window.addEventListener('unhandledrejection', e => fail(e.reason || new Error('Unhandled error')));
window.addEventListener('beforeunload', () => { try { recognition?.abort(); } catch {} try { worker?.terminate(); } catch {} });
refreshDevices().catch(() => {});
