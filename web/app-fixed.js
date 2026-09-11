const $ = (id) => document.getElementById(id);

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
  console.error(error);
  setStatus(message, 'err');
  if (cloneStatus) cloneStatus.textContent = message;
}

async function loadVoxShot() {
  if (VoxShot && WorkerSynthesisEngine) return;
  setStatus('Loading VoxShot…');

  // Lazy-load the library so a CDN/import problem cannot prevent the GUI
  // buttons from being registered.
  const mod = await import('https://esm.sh/gh/m96-chan/voxshot@main');
  VoxShot = mod.VoxShot;
  WorkerSynthesisEngine = mod.WorkerSynthesisEngine;

  if (!VoxShot || !WorkerSynthesisEngine) {
    throw new Error('VoxShot browser API failed to load. Refresh and try again.');
  }
}

async function loadModel() {
  if (tts) return tts;
  if (modelPromise) return modelPromise;
  if (!navigator.gpu) {
    throw new Error('WebGPU is unavailable. Use current Chrome or Edge with WebGPU enabled.');
  }

  modelPromise = (async () => {
    await loadVoxShot();
    setStatus('Starting Chatterbox…');

    worker = new Worker('./tts.worker.js', { type: 'module' });
    worker.addEventListener('error', (event) => {
      console.error('Chatterbox worker error:', event.error || event.message);
    });

    workerEngine = new WorkerSynthesisEngine(worker);
    tts = await VoxShot.create({
      engine: workerEngine,
      device: 'webgpu',
      minChunkLength: 20
    });

    setStatus('Chatterbox ready.', 'ok');
    return tts;
  })().catch((error) => {
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

    const isWav = /\.wav$/i.test(file.name) ||
      file.type === 'audio/wav' || file.type === 'audio/x-wav' || file.type === 'audio/wave';
    if (!isWav) throw new Error('Please choose a WAV voice file.');
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
  if (outputId !== 'default' && typeof player.setSinkId === 'function') {
    await player.setSinkId(outputId);
  }

  const url = URL.createObjectURL(audio.toBlob());
  player.src = url;
  try {
    await player.play();
    await new Promise((resolve, reject) => {
      const done = () => resolve();
      const failed = (event) => reject(event.error || new Error('Audio playback failed.'));
      player.addEventListener('ended', done, { once: true });
      player.addEventListener('error', failed, { once: true });
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function speakPhrase(phrase) {
  if (!cloned) return;
  const value = phrase.trim().slice(0, 160);
  if (!value) return;

  const engine = await loadModel();
  speaking = true;
  setStatus('Speaking your cloned voice…');

  try {
    for await (const chunk of engine.stream(value)) {
      await playSynth(chunk);
    }
  } finally {
    speaking = false;
  }
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
  if (phraseQueue.length >= 2) phraseQueue.shift();
  phraseQueue.push(phrase);
  void drainQueue();
}

async function openMic() {
  if (micStream) return;

  const constraints = inputDevice.value
    ? {
        audio: {
          deviceId: { exact: inputDevice.value },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      }
    : {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      };

  micStream = await navigator.mediaDevices.getUserMedia(constraints);
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

  r.onresult = (event) => {
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

  r.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      listening = false;
      setStatus('Microphone or speech-recognition permission was denied.', 'err');
    } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
      setStatus(`Speech recognition: ${event.error}`, 'err');
    }
  };

  r.onend = () => {
    if (!listening || restarting) return;
    restarting = true;
    setTimeout(() => {
      if (!listening) return;
      try {
        r.start();
      } catch {
        restarting = false;
        setTimeout(() => {
          if (listening) {
            try { r.start(); } catch {}
          }
        }, 500);
      }
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
    phraseQueue = [];
    transcript.textContent = 'Listening…';
    startBtn.textContent = 'Echo is running…';

    try {
      recognition.start();
    } catch (error) {
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
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }

  startBtn.textContent = 'Start voice echo';
  setStatus(cloned ? 'Voice clone ready.' : 'Ready.');
}

async function testVoice() {
  try {
    if (!cloned) throw new Error('Clone the WAV voice first.');
    const value = text.value.trim();
    if (!value) throw new Error('Type something to test the cloned voice.');
    await speakPhrase(value);
    if (!listening) setStatus('Test complete.', 'ok');
  } catch (error) {
    fail(error);
  }
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;

  const devices = await navigator.mediaDevices.enumerateDevices();
  const previousInput = inputDevice.value;
  const previousOutput = outputId;

  inputDevice.innerHTML = '<option value="">Default microphone</option>';
  outputDevice.innerHTML = '<option value="default">Default Windows output</option>';

  for (const device of devices) {
    if (device.kind === 'audioinput' && device.deviceId) {
      inputDevice.add(new Option(device.label || 'Microphone', device.deviceId));
    }

    if (device.kind === 'audiooutput' && device.deviceId) {
      const label = /cable input|vb-audio cable|virtual audio cable/i.test(device.label || '')
        ? 'VB-CABLE — CABLE Input'
        : (device.label || 'Audio output');
      outputDevice.add(new Option(label, device.deviceId));
    }
  }

  if ([...inputDevice.options].some((o) => o.value === previousInput)) {
    inputDevice.value = previousInput;
  }
  if ([...outputDevice.options].some((o) => o.value === previousOutput)) {
    outputDevice.value = previousOutput;
  }

  routingStatus.textContent = `Voice output → ${outputDevice.selectedOptions[0]?.text || 'Default Windows output'}.`;
}

voiceFile.addEventListener('change', () => {
  const file = voiceFile.files?.[0];
  cloneStatus.textContent = file ? `Selected: ${file.name}` : 'No voice loaded.';
});

$('clone').addEventListener('click', cloneWav);

$('clearVoice').addEventListener('click', () => {
  stopEcho();
  cloned = false;
  voiceFile.value = '';
  cloneStatus.textContent = 'No voice loaded.';
  setStatus('Voice clone cleared.');
});

startBtn.addEventListener('click', startEcho);
$('stop').addEventListener('click', stopEcho);
$('test').addEventListener('click', testVoice);
$('refreshDevices').addEventListener('click', () => refreshDevices().catch(fail));

$('chooseOutput').addEventListener('click', async () => {
  try {
    if (!navigator.mediaDevices?.selectAudioOutput) {
      throw new Error('Output picker is unavailable. Use the Voice output list instead.');
    }
    const device = await navigator.mediaDevices.selectAudioOutput();
    if (device?.deviceId) {
      outputId = device.deviceId;
      await refreshDevices();
      outputDevice.value = device.deviceId;
      routingStatus.textContent = `Voice output → ${device.label || 'Selected output'}.`;
    }
  } catch (error) {
    fail(error);
  }
});

outputDevice.addEventListener('change', () => {
  outputId = outputDevice.value || 'default';
  routingStatus.textContent = `Voice output → ${outputDevice.selectedOptions[0]?.text || 'Default Windows output'}.`;
});

inputDevice.addEventListener('change', () => {
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }
});

window.addEventListener('error', (event) => fail(event.error || new Error(event.message)));
window.addEventListener('unhandledrejection', (event) => fail(event.reason || new Error('Unhandled error')));
window.addEventListener('beforeunload', () => {
  try { recognition?.abort(); } catch {}
  try { micStream?.getTracks().forEach((track) => track.stop()); } catch {}
  try { worker?.terminate(); } catch {}
});

refreshDevices().catch(() => {});
