const $ = id => document.getElementById(id);
const apiKey = $('apiKey');
const voiceUuid = $('voiceUuid');
const sourceUrl = $('sourceUrl');
const pitch = $('pitch');
const prompt = $('prompt');
const statusEl = $('status');
const transcriptEl = $('text');
const meterFill = $('meterFill');
const startBtn = $('start');
const convertBtn = $('convert');
const stopBtn = $('stop');

let running = false;
const PYTHON = 'http://127.0.0.1:17856';

function setStatus(text){ statusEl.textContent = text; }
function setRunning(v){
  running = v;
  startBtn.disabled = v;
  stopBtn.disabled = !v;
  convertBtn.disabled = !v;
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
    source_url: sourceUrl.value.trim(),
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
    if(data.source_url) sourceUrl.value = data.source_url;
    if(data.pitch !== undefined) pitch.value = data.pitch;
    if(data.prompt) prompt.value = data.prompt;
    if(data.api_key === 'configured') apiKey.placeholder = 'API key already configured locally';
  }catch{}
}

async function refreshStatus(){
  try{
    const data = await python('/status');
    setRunning(!!data.running);
    if(data.error) setStatus(data.error);
    else if(data.status) setStatus(data.status);
    if(data.duration) transcriptEl.textContent = `Last Resemble output: ${Number(data.duration).toFixed(2)} seconds`;
  }catch{
    setStatus('Resemble bridge offline — launch the mod first');
    setRunning(false);
  }
}

async function connect(){
  try{
    setStatus('Saving Resemble settings…');
    await saveConfig();
    await python('/start', {method:'POST', body:'{}'});
    setRunning(true);
    transcriptEl.textContent = 'Connected to the local Resemble STS bridge.';
    meterFill.style.width = '20%';
    setStatus('Resemble connected');
  }catch(err){
    setRunning(false);
    setStatus('Resemble error: ' + err.message);
  }
}

async function convert(){
  if(!running) await connect();
  if(!running) return;
  try{
    await saveConfig();
    setStatus('Converting with Resemble…');
    transcriptEl.textContent = 'Uploading/requesting the donor WAV from Resemble and waiting for the converted WAV…';
    meterFill.style.width = '65%';
    const data = await python('/convert', {method:'POST', body:JSON.stringify({
      source_url: sourceUrl.value.trim(),
      pitch: Number(pitch.value || 0),
      prompt: prompt.value.trim()
    })});
    meterFill.style.width = '100%';
    transcriptEl.textContent = `Converted ${Number(data.duration || 0).toFixed(2)} seconds of audio in ${Number(data.elapsed || 0).toFixed(2)} seconds.`;
    setStatus('Conversion complete');
  }catch(err){
    meterFill.style.width = '0%';
    setStatus('Conversion error: ' + err.message);
    transcriptEl.textContent = err.message;
  }
}

async function stop(){
  try{ await python('/stop', {method:'POST', body:'{}'}); }catch(err){ setStatus(err.message); }
  setRunning(false);
  meterFill.style.width = '0%';
  transcriptEl.textContent = 'Stopped';
  setStatus('Stopped');
}

startBtn.onclick = connect;
convertBtn.onclick = convert;
stopBtn.onclick = stop;

(async()=>{
  setRunning(false);
  await loadConfig();
  await refreshStatus();
  setInterval(refreshStatus, 1500);
})();
