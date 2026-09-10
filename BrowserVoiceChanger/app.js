const $ = id => document.getElementById(id);
const strength = $('strength'), outputSelect = $('output');
const statusEl = $('status'), transcriptEl = $('text'), meterFill = $('meterFill');
const startBtn = $('start'), stopBtn = $('stop'), targetWav = $('targetWav');

let running = false;
const PYTHON = 'http://127.0.0.1:17856';

function setStatus(text){ statusEl.textContent = text; }
function setRunning(v){ running = v; startBtn.disabled = v; stopBtn.disabled = !v; }

async function python(path, options = {}){
  const response = await fetch(PYTHON + path, {
    ...options,
    headers: {'Content-Type':'application/json', ...(options.headers || {})}
  });
  const data = await response.json().catch(() => ({}));
  if(!response.ok) throw new Error(data.error || `WAV engine HTTP ${response.status}`);
  return data;
}

async function enumerateOutputs(){
  try{
    const devices = await python('/devices');
    const old = localStorage.getItem('voicechanger.output') || '';
    outputSelect.replaceChildren();
    outputSelect.add(new Option('Default Windows output', ''));
    for(const device of devices) outputSelect.add(new Option(`${device.id}: ${device.name}`, String(device.id)));
    outputSelect.value = old && [...outputSelect.options].some(o => o.value === old) ? old : '';
  }catch{
    outputSelect.replaceChildren(new Option('Default Windows output', ''));
  }
}

async function refreshStatus(){
  try{
    const data = await python('/status');
    setRunning(!!data.running);
    if(data.target_wav) targetWav.value = data.target_wav;
    if(data.error) setStatus(data.error);
    else if(data.status) setStatus(data.status);
    if(data.target_pitch) transcriptEl.textContent = `Target WAV loaded — estimated target pitch: ${data.target_pitch} Hz`;
  }catch{}
}

async function start(){
  if(running) return;
  try{
    setStatus('Starting local WAV engine…');
    await python('/config', {method:'POST', body:JSON.stringify({
      pitch_strength: Number(strength.value) / 100,
      output_gain: 1.0
    })});
    await python('/start', {method:'POST', body:'{}'});
    setRunning(true);
    transcriptEl.textContent = 'Live conversion: microphone WAV → local target WAV profile → WAV';
    meterFill.style.width = '100%';
    setStatus('LIVE — WAV-only conversion running');
  }catch(err){
    setRunning(false);
    setStatus('WAV engine error: ' + err.message);
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
strength.oninput = () => localStorage.setItem('voicechanger.strength', strength.value);
outputSelect.onchange = () => localStorage.setItem('voicechanger.output', outputSelect.value);
strength.value = localStorage.getItem('voicechanger.strength') || '82';

(async()=>{
  await enumerateOutputs();
  await refreshStatus();
  setInterval(refreshStatus, 1000);
})();
