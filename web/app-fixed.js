const $ = id => document.getElementById(id);
const status = $('status'), cloneStatus = $('cloneStatus'), voiceFile = $('voiceFile');
let VoxShot = null, WorkerSynthesisEngine = null, tts = null, worker = null, workerEngine = null, loading = null, cloned = false;
function setStatus(message, kind=''){ status.textContent=message; status.className=`status ${kind}`; }
function fail(error){ const message=error?.message||String(error); setStatus(message,'err'); cloneStatus.textContent=message; }
async function loadLib(){
  if(VoxShot) return;
  setStatus('Loading VoxShot…');
  const mod=await import('https://esm.sh/gh/m96-chan/voxshot@main');
  VoxShot=mod.VoxShot; WorkerSynthesisEngine=mod.WorkerSynthesisEngine;
  if(!VoxShot||!WorkerSynthesisEngine) throw new Error('VoxShot browser API failed to load.');
}
async function loadModel(){
  if(tts) return tts;
  if(loading) return loading;
  if(!navigator.gpu) throw new Error('WebGPU is unavailable. Use current Chrome or Edge with WebGPU enabled.');
  loading=(async()=>{
    await loadLib();
    setStatus('Starting Chatterbox…');
    worker=new Worker('/tts.worker.js',{type:'module'});
    workerEngine=new WorkerSynthesisEngine(worker);
    tts=await VoxShot.create({engine:workerEngine,device:'webgpu',minChunkLength:20});
    setStatus('Chatterbox ready.','ok');
    return tts;
  })().catch(e=>{try{worker?.terminate()}catch{} worker=null; workerEngine=null; loading=null; throw e;});
  return loading;
}
async function cloneWav(){
  try{
    const file=voiceFile.files?.[0];
    if(!file) throw new Error('Choose a WAV file first.');
    if(!/\.wav$/i.test(file.name)&&!['audio/wav','audio/x-wav'].includes(file.type)) throw new Error('Please choose a WAV voice file.');
    cloned=false; cloneStatus.textContent='Loading Chatterbox…'; setStatus('Loading Chatterbox…');
    const engine=await loadModel(); cloneStatus.textContent='Cloning WAV voice locally…';
    await engine.cloneVoice(file); cloned=true; cloneStatus.textContent=`Voice ready: ${file.name}`; setStatus('Voice clone ready.','ok');
  }catch(e){cloned=false;cloneStatus.textContent=`Clone failed: ${e?.message||e}`;fail(e);}
}
$('clone').onclick=cloneWav;
voiceFile.onchange=()=>{const f=voiceFile.files?.[0];cloneStatus.textContent=f?`Selected: ${f.name}`:'No voice loaded.';};
$('clearVoice').onclick=()=>{cloned=false;voiceFile.value='';cloneStatus.textContent='No voice loaded.';setStatus('Voice clone cleared.');};
$('test').onclick=async()=>{try{if(!cloned)throw new Error('Clone the WAV voice first.');const a=await loadModel().then(x=>x.speak($('text').value));await a.play();setStatus('Test complete.','ok');}catch(e){fail(e);}};
$('start').onclick=()=>{if(!cloned)return fail(new Error('Clone the WAV voice first.'));setStatus('Echo mode is ready.','ok');};
$('stop').onclick=()=>setStatus(cloned?'Voice clone ready.':'Ready.');
window.addEventListener('error',e=>fail(e.error||new Error(e.message)));
window.addEventListener('unhandledrejection',e=>fail(e.reason||new Error('Unhandled error')));
