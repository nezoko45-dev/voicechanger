const $ = id => document.getElementById(id);
const apiKey = $('apiKey'), inputSelect = $('mic'), outputSelect = $('output'), voiceSelect = $('voice');
const statusEl = $('status'), transcriptEl = $('text'), meterFill = $('meterFill');
const startBtn = $('start'), stopBtn = $('stop');

const BRIDGE = 'http://127.0.0.1:17846';
const voices = [
  ['Thalia','aura-2-thalia-en'],['Andromeda','aura-2-andromeda-en'],['Helena','aura-2-helena-en'],
  ['Amalthea (Filipino)','aura-2-amalthea-en'],['Luna','aura-2-luna-en'],['Minerva','aura-2-minerva-en'],
  ['Ophelia','aura-2-ophelia-en'],['Phoebe','aura-2-phoebe-en'],['Selene','aura-2-selene-en'],
  ['Theia','aura-2-theia-en'],['Vesta','aura-2-vesta-en'],['Asteria','aura-2-asteria-en'],
  ['Athena','aura-2-athena-en'],['Pandora','aura-2-pandora-en'],['Apollo','aura-2-apollo-en'],
  ['Arcas','aura-2-arcas-en'],['Aries','aura-2-aries-en'],['Jupiter','aura-2-jupiter-en'],
  ['Mars','aura-2-mars-en'],['Neptune','aura-2-neptune-en'],['Odysseus','aura-2-odysseus-en'],
  ['Orion','aura-2-orion-en'],['Orpheus','aura-2-orpheus-en'],['Pluto','aura-2-pluto-en'],
  ['Saturn','aura-2-saturn-en'],['Zeus','aura-2-zeus-en']
];
for (const [name, model] of voices) voiceSelect.add(new Option(name, model));
voiceSelect.value = localStorage.getItem('voicechanger.voice') || 'aura-2-thalia-en';
apiKey.value = localStorage.getItem('voicechanger.key') || '';

let running = false;

function setStatus(text){ statusEl.textContent = text; }
function setRunning(v){ running=v; startBtn.disabled=v; stopBtn.disabled=!v; }
function validApiKey(key){ return !!key && key.length >= 20 && !/[\r\n]/.test(key); }

async function bridge(path, options = {}) {
  const response = await fetch(BRIDGE + path, { ...options, cache:'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Bridge HTTP ${response.status}`);
  return data;
}

async function enumerateAudio(){
  try {
    const data = await bridge('/devices');
    const devices = data.devices || [];
    const oldIn=inputSelect.value, oldOut=outputSelect.value;
    inputSelect.replaceChildren(); outputSelect.replaceChildren();
    const inputs = devices.filter(d=>d.inputs>0);
    const outputs = devices.filter(d=>d.outputs>0);
    for(const d of inputs) inputSelect.add(new Option(`${d.name} [input ${d.index}]`, String(d.index)));
    for(const d of outputs) outputSelect.add(new Option(`${d.name} [output ${d.index}]`, String(d.index)));
    const repeater = [...inputSelect.options].find(o=>/audio repeater|kernel streaming|repeater/i.test(o.text));
    if(repeater) inputSelect.value=repeater.value;
    else if(oldIn) inputSelect.value=oldIn;
    const vac = [...outputSelect.options].find(o=>/virtual audio cable|vb-audio|vac/i.test(o.text));
    if(vac) outputSelect.value=vac.value;
    else if(oldOut) outputSelect.value=oldOut;
    setStatus(`Native audio ready — ${inputs.length} inputs / ${outputs.length} outputs`);
  } catch(err) {
    setStatus('Native bridge unavailable — install the Python requirements');
  }
}

async function poll(){
  try {
    const s=await bridge('/status');
    if(s.transcript) transcriptEl.textContent=s.transcript;
    if(s.error) setStatus(s.error);
    else if(s.running) setStatus('Listening — native audio');
    meterFill.style.width=s.running?'70%':'0%';
    if(s.running!==running) setRunning(s.running);
  } catch { if(!running) setStatus('Waiting for native audio bridge…'); }
}

async function start(){
  if(running) return;
  const key=apiKey.value.trim();
  if(!validApiKey(key)){ setStatus('Enter your Deepgram API key'); apiKey.focus(); return; }
  if(!inputSelect.value || !outputSelect.value){ await enumerateAudio(); }
  try {
    setStatus('Connecting native audio…');
    await bridge('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      api_key:key,input_device:inputSelect.value,output_device:outputSelect.value,voice:voiceSelect.value
    })});
    await bridge('/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    localStorage.setItem('voicechanger.key',key);
    localStorage.setItem('voicechanger.voice',voiceSelect.value);
    setRunning(true); setStatus('Listening — Audio Repeater → Deepgram → VAC');
  } catch(err) {
    setRunning(false); setStatus(err.message || String(err));
  }
}

async function stop(){
  try { await bridge('/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); } catch {}
  setRunning(false); meterFill.style.width='0%'; setStatus('Stopped');
}

startBtn.onclick=start;
stopBtn.onclick=stop;
voiceSelect.onchange=()=>localStorage.setItem('voicechanger.voice',voiceSelect.value);
apiKey.onchange=()=>localStorage.setItem('voicechanger.key',apiKey.value.trim());
inputSelect.onchange=()=>localStorage.setItem('voicechanger.input',inputSelect.value);
outputSelect.onchange=()=>localStorage.setItem('voicechanger.output',outputSelect.value);

(async()=>{ await enumerateAudio(); setInterval(poll,500); await poll(); })();
