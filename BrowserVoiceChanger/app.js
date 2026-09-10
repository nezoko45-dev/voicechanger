const $ = id => document.getElementById(id);
const apiKey = $('apiKey');
const voiceUuid = $('voiceUuid');
const pitch = $('pitch');
const prompt = $('prompt');
const statusEl = $('status');
const transcriptEl = $('text');
const meterFill = $('meterFill');
const startBtn = $('start');
const recordBtn = $('record');
const stopBtn = $('stop');

const PYTHON = 'http://127.0.0.1:17856';
let running = false;
let recording = false;
let recorder = null;
let stream = null;

function setStatus(text){ statusEl.textContent = text; }
function setRunning(v){
  running = v;
  startBtn.disabled = v;
  recordBtn.disabled = !v;
  stopBtn.disabled = !v;
}

async function python(path, options = {}){
  const response = await fetch(PYTHON + path, {
    ...options,
    headers: {'Content-Type':'application/json', ...(options.headers || {})}
  });
  const data = await response.json().catch(() => ({}));
  if(!response.ok) throw new Error(data.error || `Resemble bridge HTTP ${response.status}`);
  return data;
}

async function saveConfig(){
  const payload = {
    voice_uuid: voiceUuid.value.trim(),
    pitch: Number(pitch.value || 0),
    prompt: prompt.value.trim()
  };
  if(apiKey.value.trim()) payload.api_key = apiKey.value.trim();
  await python('/config', {method:'POST', body:JSON.stringify(payload)});
}

async function loadConfig(){
  try{
    const data = await python('/config');
    if(data.voice_uuid) voiceUuid.value = data.voice_uuid;
    if(data.pitch !== undefined) pitch.value = data.pitch;
    if(data.prompt) prompt.value = data.prompt;
    if(data.api_key === 'configured') apiKey.placeholder = 'API key already configured locally';
  }catch{}
}

async function loadVoices(){
  setStatus('Loading your Resemble custom voice library…');
  const data = await python('/voices');
  const previous = voiceUuid.value;
  voiceUuid.innerHTML = '';
  const voices = data.voices || [];
  if(!voices.length){
    voiceUuid.add(new Option('No voices found', ''));
    throw new Error('No Resemble voices were returned for this account.');
  }
  voices.forEach(v => {
    const option = new Option(`${v.name || 'Unnamed'} — ${v.uuid || ''}`, v.uuid || '');
    voiceUuid.add(option);
  });
  if(previous) voiceUuid.value = previous;
  if(!voiceUuid.value && voices[0]?.uuid) voiceUuid.value = voices[0].uuid;
  await saveConfig();
}

async function connect(){
  try{
    setRunning(false);
    setStatus('Saving Resemble API key…');
    await saveConfig();

    // Load the voice library BEFORE starting the engine. The previous order
    // called /start while voice_uuid was still empty, which made startup fail.
    await loadVoices();

    if(!voiceUuid.value.trim()) throw new Error('No Resemble custom voice is selected.');

    setStatus('Starting Resemble STT/TTS…');
    await python('/start', {method:'POST', body:'{}'});
    setRunning(true);
    transcriptEl.textContent = 'Connected. Your Resemble custom voices are loaded.';
    meterFill.style.width = '20%';
    setStatus('Resemble STT/TTS connected');
  }catch(err){
    setRunning(false);
    setStatus('Resemble error: ' + err.message);
    transcriptEl.textContent = err.message;
  }
}

function pickMime(){
  const choices = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];
  return choices.find(x => MediaRecorder.isTypeSupported(x)) || '';
}

async function startVoiceChanger(){
  if(!running) return;
  if(recording) return;
  try{
    await saveConfig();
    stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    const mime = pickMime();
    recorder = mime ? new MediaRecorder(stream,{mimeType:mime}) : new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      const type = recorder.mimeType || mime || 'audio/webm';
      const blob = new Blob(chunks,{type});
      chunks.length = 0;
      try{
        setStatus('Resemble STT: transcribing…');
        transcriptEl.textContent = 'Listening finished — sending your speech to Resemble STT…';
        meterFill.style.width = '55%';
        const response = await fetch(PYTHON + '/stt-tts', {
          method:'POST',
          headers:{'Content-Type':type,'X-Audio-Type':type},
          body:blob
        });
        const data = await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(data.error || `Voice changer HTTP ${response.status}`);
        transcriptEl.textContent = data.text || '(No speech recognized)';
        meterFill.style.width = '100%';
        setStatus('Custom voice reply complete');
      }catch(err){
        setStatus('Voice changer error: ' + err.message);
        transcriptEl.textContent = err.message;
        meterFill.style.width = '0%';
      }
      if(recording && running) setStatus('Ready — press Start Voice Changer for the next sentence');
    };
    recorder.start();
    recording = true;
    recordBtn.textContent = 'Stop Listening';
    meterFill.style.width = '30%';
    setStatus('Listening… speak now');
    transcriptEl.textContent = 'Listening to your microphone…';
  }catch(err){
    setStatus('Microphone error: ' + err.message);
  }
}

function stopListening(){
  if(!recording || !recorder) return;
  recorder.stop();
  recording = false;
  recordBtn.textContent = 'Start Voice Changer';
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
}

async function stop(){
  stopListening();
  try{ await python('/stop', {method:'POST', body:'{}'}); }catch(err){ setStatus(err.message); }
  setRunning(false);
  meterFill.style.width = '0%';
  setStatus('Stopped');
}

startBtn.onclick = connect;
recordBtn.onclick = () => recording ? stopListening() : startVoiceChanger();
stopBtn.onclick = stop;
voiceUuid.onchange = saveConfig;
pitch.onchange = saveConfig;
prompt.onchange = saveConfig;

(async()=>{
  setRunning(false);
  await loadConfig();
})();
