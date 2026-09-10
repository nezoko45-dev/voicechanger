const $ = id => document.getElementById(id);
const apiKey = $('apiKey'), voiceId = $('voiceId'), outputSelect = $('output');
const statusEl = $('status'), transcriptEl = $('text'), meterFill = $('meterFill');
const startBtn = $('start'), stopBtn = $('stop');

let running = false;
const PYTHON = 'http://127.0.0.1:17856';

function setStatus(text){ statusEl.textContent = text; }
function setRunning(v){ running = v; startBtn.disabled = v; stopBtn.disabled = !v; }
function validApiKey(key){ return !!key && key.length >= 20 && key.length <= 500 && !/[\r\n]/.test(key); }
function validVoiceId(id){ return !!id && id.length >= 8 && id.length <= 200 && !/[\r\n]/.test(id); }

async function python(path, options = {}){
  const response = await fetch(PYTHON + path, {
    ...options,
    headers: {'Content-Type':'application/json', ...(options.headers || {})}
  });
  const data = await response.json().catch(() => ({}));
  if(!response.ok) throw new Error(data.error || `Python engine HTTP ${response.status}`);
  return data;
}

async function enumerateOutputs(){
  try{
    const devices = await python('/devices');
    const old = localStorage.getItem('voicechanger.output') || '';
    outputSelect.replaceChildren();
    outputSelect.add(new Option('Default Windows output', ''));
    for(const device of devices){
      outputSelect.add(new Option(`${device.id}: ${device.name}`, String(device.id)));
    }
    if(old && [...outputSelect.options].some(o => o.value === old)) outputSelect.value = old;
    else outputSelect.value = '';
  }catch(err){
    outputSelect.replaceChildren(new Option('Start Python engine first', ''));
  }
}

async function refreshStatus(){
  try{
    const data = await python('/status');
    setRunning(!!data.running);
    if(data.voice_id && !voiceId.value) voiceId.value = data.voice_id;
    if(data.error) setStatus(data.error);
    else if(data.status) setStatus(data.status);
  }catch{}
}

async function start(){
  if(running) return;
  const key = apiKey.value.trim();
  const id = voiceId.value.trim();
  if(!validApiKey(key)){ setStatus('Enter your ElevenLabs API key'); apiKey.focus(); return; }
  if(!validVoiceId(id)){ setStatus('Enter the ElevenLabs Voice ID for your target WAV voice'); voiceId.focus(); return; }
  sessionStorage.setItem('voicechanger.elevenlabs', key);
  localStorage.setItem('voicechanger.voiceid', id);
  localStorage.setItem('voicechanger.output', outputSelect.value);
  try{
    setStatus('Starting Python WAV engine…');
    await python('/config', {method:'POST', body:JSON.stringify({
      output_device: outputSelect.value === '' ? null : Number(outputSelect.value),
      voice_id: id
    })});
    await python('/start', {method:'POST', body:JSON.stringify({api_key:key, voice_id:id})});
    setRunning(true);
    transcriptEl.textContent = 'Live conversion: microphone WAV → ElevenLabs → WAV → selected output';
    meterFill.style.width = '100%';
    setStatus('LIVE — WAV conversion running');
  }catch(err){
    setRunning(false);
    setStatus('Python engine error: ' + err.message);
  }
}

async function stop(){
  try{ await python('/stop', {method:'POST', body:'{}'}); }catch(err){ setStatus(err.message); }
  setRunning(false);
  meterFill.style.width = '0%';
  transcriptEl.textContent = 'Stopped';
  setStatus('Stopped');
}

startBtn.onclick = start;
stopBtn.onclick = stop;
apiKey.value = sessionStorage.getItem('voicechanger.elevenlabs') || localStorage.getItem('voicechanger.elevenlabs') || '';
voiceId.value = localStorage.getItem('voicechanger.voiceid') || '';
outputSelect.onchange = () => localStorage.setItem('voicechanger.output', outputSelect.value);

(async()=>{
  await enumerateOutputs();
  await refreshStatus();
  setInterval(refreshStatus, 1000);
})();
