'use strict';

const $ = id => document.getElementById(id);
const start = $('start');
const stop = $('stop');
const status = $('status');
const meter = $('meter');
const transcript = $('transcript');
const voice = $('voice');
const debug = $('debug');

let running = false;
let stream = null;
let ctx = null;
let source = null;
let processor = null;
let socket = null;

// Replace this with your real Supabase Edge Function URL.
const TOKEN_ENDPOINT = 'https://xxxxxxxxxxxx.supabase.co/functions/v1/assembly-token';

const setStatus = (text, progress) => {
  status.textContent = text;
  if (progress !== undefined) meter.style.width = progress + '%';
};

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
    if (current.readyState === WebSocket.OPEN) {
      current.send(JSON.stringify({ type: 'Terminate' }));
    }
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

  try {
    setStatus('🎤 Requesting microphone…', 10);
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

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

async function getToken() {
  setStatus('🔐 Getting temporary AssemblyAI token…', 20);
  const response = await fetch(TOKEN_ENDPOINT, { cache: 'no-store' }).catch(() => null);
  if (!response) throw new Error('Could not reach the Supabase Edge Function.');
  if (!response.ok) {
    throw new Error('Token service returned HTTP ' + response.status + '. Check the Supabase secret and deployment.');
  }

  const data = await response.json();
  if (!data.token) throw new Error(data.error || 'Token service returned no token.');
  return data.token;
}

function openAssembly() {
  return getToken().then(token => new Promise((resolve, reject) => {
    const url = 'wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=universal-3-5-pro&token=' + encodeURIComponent(token);
    let opened = false;
    setStatus('🔌 Connecting AssemblyAI…', 35);
    debug.textContent = 'WebSocket: connecting…';

    let current;
    try {
      current = new WebSocket(url);
      socket = current;
    } catch (error) {
      reject(error);
      return;
    }

    const timer = setTimeout(() => {
      if (!opened) {
        try { current.close(); } catch {}
        reject(new Error('AssemblyAI WebSocket timed out.'));
      }
    }, 10000);

    current.onopen = () => {
      if (current !== socket || !running) return;
      opened = true;
      clearTimeout(timer);
      debug.textContent = 'WebSocket: OPEN';
      startAudio();
      resolve();
    };

    current.onmessage = event => handleMessage(event.data);

    current.onerror = () => {
      if (current === socket && running) {
        debug.textContent = 'WebSocket: ERROR';
        setStatus('❌ AssemblyAI WebSocket error.', 0);
      }
    };

    current.onclose = event => {
      clearTimeout(timer);
      if (current !== socket) return;
      socket = null;
      stopAudio();
      debug.textContent = 'WebSocket: CLOSED ' + event.code + ' ' + (event.reason || '(no reason)');
      if (running) {
        running = false;
        start.disabled = false;
        stop.disabled = true;
        setStatus('❌ AssemblyAI disconnected (' + event.code + ').', 0);
      }
    };
  }));
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
