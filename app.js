'use strict';

const $ = id => document.getElementById(id);
const start = $('start');
const stop = $('stop');
const status = $('status');
const meter = $('meter');
const transcript = $('transcript');
const voice = $('voice');
const debug = $('debug');
const provider = $('provider');
const apiKey = $('apiKey');
const saveKey = $('saveKey');
const useKey = $('useKey');
const clearKey = $('clearKey');
const keyStatus = $('keyStatus');

let running = false;
let stream = null;
let ctx = null;
let source = null;
let processor = null;
let socket = null;
let activeKey = '';

const STORAGE_PREFIX = 'voicechanger.apiKey.';

const setStatus = (text, progress) => {
  status.textContent = text;
  if (progress !== undefined) meter.style.width = progress + '%';
};

function storageName() {
  return STORAGE_PREFIX + provider.value;
}

function refreshKeyStatus() {
  const saved = localStorage.getItem(storageName());
  keyStatus.textContent = saved ? provider.options[provider.selectedIndex].text + ' key saved locally.' : 'No API key saved for ' + provider.options[provider.selectedIndex].text + '.';
  apiKey.value = '';
}

saveKey.onclick = () => {
  const value = apiKey.value.trim();
  if (!value) {
    keyStatus.textContent = 'Enter an API key first.';
    return;
  }
  localStorage.setItem(storageName(), value);
  activeKey = value;
  apiKey.value = '';
  keyStatus.textContent = provider.options[provider.selectedIndex].text + ' key saved and selected locally.';
};

useKey.onclick = () => {
  const value = localStorage.getItem(storageName());
  if (!value) {
    keyStatus.textContent = 'No saved key for this provider.';
    return;
  }
  activeKey = value;
  keyStatus.textContent = provider.options[provider.selectedIndex].text + ' key selected.';
};

clearKey.onclick = () => {
  localStorage.removeItem(storageName());
  activeKey = '';
  refreshKeyStatus();
};

provider.onchange = () => {
  activeKey = '';
  refreshKeyStatus();
};

refreshKeyStatus();

function stopAudio() {
  if (processor) {
    try { processor.disconnect(); } catch {}
    processor.onaudioprocess = null;
    processor = null;
  }
  if (source) {
    try { source.disconnect(); } catch {}
    source = null;
  }
  if (ctx) {
    try { ctx.close(); } catch {}
    ctx = null;
  }
}

function closeSocket() {
  const current = socket;
  socket = null;
  if (!current) return;
  try {
    if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'Terminate' }));
  } catch {}
  try { current.close(); } catch {}
}

function stopAll() {
  running = false;
  stopAudio();
  closeSocket();
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  speechSynthesis.cancel();
  start.disabled = false;
  stop.disabled = true;
  meter.style.width = '0';
  debug.textContent = 'WebSocket: stopped';
  setStatus('Ready.', 0);
}

stop.onclick = stopAll;

start.onclick = async () => {
  if (running) return;
  if (!activeKey) {
    setStatus('❌ Select an API key first.', 0);
    return;
  }
  if (provider.value !== 'assemblyai') {
    setStatus('ℹ️ ' + provider.options[provider.selectedIndex].text + ' is saved for the next provider integration.', 0);
    return;
  }

  try {
    setStatus('🎤 Requesting microphone…', 10);
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    running = true;
    start.disabled = true;
    stop.disabled = false;
    transcript.textContent = '—';
    voice.textContent = 'Listening…';
    await openAssembly();
    setStatus('🎤 Connected — listening…', 100);
  } catch (error) {
    debug.textContent = 'ERROR: ' + error.message;
    stopAll();
    setStatus('❌ ' + error.message, 0);
  }
};

function openAssembly() {
  // Browsers cannot add the required Authorization header to a native WebSocket.
  // The selected key is therefore kept as the provider-selection interface only;
  // a server-issued temporary token is required for a real browser connection.
  return Promise.reject(new Error('AssemblyAI browser connections require a temporary token. No Supabase/backend is configured.'));
}

function startAudio() {
  if (!running || !stream || !socket || socket.readyState !== WebSocket.OPEN) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  source = ctx.createMediaStreamSource(stream);
  processor = ctx.createScriptProcessor(4096, 1, 1);
  const rate = ctx.sampleRate;

  processor.onaudioprocess = event => {
    if (!running || !socket || socket.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    const count = Math.max(1, Math.round(input.length * 16000 / rate));
    const pcm = new Int16Array(count);
    for (let i = 0; i < count; i++) {
      const position = i * rate / 16000;
      const a = Math.floor(position);
      const b = Math.min(a + 1, input.length - 1);
      const fraction = position - a;
      const value = input[a] * (1 - fraction) + input[b] * fraction;
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
    }
    try { socket.send(pcm.buffer); } catch {}
  };
  source.connect(processor);
  processor.connect(ctx.destination);
  ctx.resume().catch(() => {});
}

function handleMessage(raw) {
  if (typeof raw !== 'string') return;
  let data;
  try { data = JSON.parse(raw); } catch { return; }
  if (data.type === 'Begin') {
    debug.textContent = 'WebSocket: OPEN — session ' + (data.id || 'ready');
    return;
  }
  if (data.type === 'Turn') {
    if (data.transcript) transcript.textContent = data.transcript;
    if (data.end_of_turn) {
      voice.textContent = '🔊 Speaking…';
      speak(data.transcript);
      setStatus('✅ Turn complete — listening…', 100);
    } else {
      voice.textContent = 'Listening…';
      setStatus('📝 Transcribing…', 100);
    }
    return;
  }
  if (data.type === 'Termination') {
    debug.textContent = 'WebSocket: TERMINATED';
    return;
  }
  if (data.type === 'Error') {
    const message = data.error || data.message || 'AssemblyAI error';
    debug.textContent = 'AssemblyAI ERROR: ' + message;
    setStatus('❌ ' + message, 0);
  }
}

function speak(text) {
  if (!text) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.onend = () => voice.textContent = '✅ Finished.';
  speechSynthesis.speak(utterance);
}

window.addEventListener('beforeunload', () => {
  running = false;
  stopAudio();
  closeSocket();
});
