const $ = id => document.getElementById(id);
const apiKey = $('apiKey'), micSelect = $('mic'), outputSelect = $('output'), voiceSelect = $('voice');
const statusEl = $('status'), transcriptEl = $('text'), meterFill = $('meterFill');
const startBtn = $('start'), stopBtn = $('stop');

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
apiKey.value = sessionStorage.getItem('voicechanger.key') || localStorage.getItem('voicechanger.key') || '';

let running=false, mediaStream=null, inputContext=null, processor=null, source=null, analyser=null, muteGain=null;
let outputContext=null, outputDestination=null, outputElement=null;
let stt=null, tts=null, ttsVoice='';
let ttsQueue=[], playing=false;

function setStatus(text){ statusEl.textContent=text; }
function setRunning(v){ running=v; startBtn.disabled=v; stopBtn.disabled=!v; }
function validApiKey(key){ return !!key && key.length>=20 && key.length<=500 && !/[\r\n]/.test(key); }
function getApiKey(){
  const key=apiKey.value.trim();
  if(!validApiKey(key)){ setStatus('Enter your Deepgram API key'); return null; }
  sessionStorage.setItem('voicechanger.key',key);
  localStorage.setItem('voicechanger.key',key);
  return key;
}

async function enumerateAudio(){
  const oldMic=localStorage.getItem('voicechanger.mic') || micSelect.value;
  const oldOut=localStorage.getItem('voicechanger.output') || outputSelect.value;
  const devices=await navigator.mediaDevices.enumerateDevices();
  micSelect.replaceChildren(); outputSelect.replaceChildren();
  devices.filter(d=>d.kind==='audioinput').forEach((d,i)=>micSelect.add(new Option(d.label||`Microphone ${i+1}`,d.deviceId)));
  devices.filter(d=>d.kind==='audiooutput').forEach((d,i)=>outputSelect.add(new Option(d.label||`Output ${i+1}`,d.deviceId)));
  if(oldMic && [...micSelect.options].some(o=>o.value===oldMic)) micSelect.value=oldMic;
  if(oldOut && [...outputSelect.options].some(o=>o.value===oldOut)) outputSelect.value=oldOut;
  const vac=[...outputSelect.options].find(o=>/virtual audio cable|line \d+ \(|vb-audio|vac/i.test(o.text));
  if(!outputSelect.value && vac) outputSelect.value=vac.value;
}

function downsampleFloat32(input,inputRate,outputRate){
  if(inputRate===outputRate){
    const out=new Int16Array(input.length);
    for(let i=0;i<input.length;i++) out[i]=Math.max(-1,Math.min(1,input[i]))*32767;
    return out;
  }
  const ratio=inputRate/outputRate,length=Math.round(input.length/ratio),out=new Int16Array(length);
  for(let i=0;i<length;i++){
    const start=Math.floor(i*ratio),end=Math.min(Math.floor((i+1)*ratio),input.length);
    let sum=0,count=0;
    for(let j=start;j<end;j++){sum+=input[j];count++;}
    out[i]=(Math.max(-1,Math.min(1,count?sum/count:input[start]||0)))*32767;
  }
  return out;
}

function pcm16ToFloat32(buffer){
  const view=new DataView(buffer),out=new Float32Array(Math.floor(buffer.byteLength/2));
  for(let i=0;i<out.length;i++) out[i]=view.getInt16(i*2,true)/32768;
  return out;
}

async function ensureOutput(){
  if(!outputContext){
    outputContext=new AudioContext({sampleRate:48000,latencyHint:'interactive'});
    outputDestination=outputContext.createMediaStreamDestination();
    outputElement=new Audio();
    outputElement.autoplay=true;
    outputElement.srcObject=outputDestination.stream;
    outputElement.style.display='none';
    document.body.appendChild(outputElement);
  }
  await outputContext.resume();
  if(outputElement.setSinkId && outputSelect.value) await outputElement.setSinkId(outputSelect.value);
}

function playTtsChunk(arrayBuffer){
  if(!outputContext || outputContext.state==='closed') return;
  const pcm=pcm16ToFloat32(arrayBuffer);
  const audio=outputContext.createBuffer(1,pcm.length,outputContext.sampleRate);
  audio.copyToChannel(pcm,0);
  ttsQueue.push(audio);
  pumpTtsQueue();
}
function pumpTtsQueue(){
  if(playing || !ttsQueue.length || !outputContext) return;
  playing=true;
  const node=outputContext.createBufferSource();
  node.buffer=ttsQueue.shift();
  node.connect(outputDestination);
  node.onended=()=>{playing=false;pumpTtsQueue();};
  node.start();
}

function openStt(key){
  const url='wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.70&eager_eot_threshold=0.50&eot_timeout_ms=7000';
  stt=new WebSocket(url,['token',key]);
  stt.binaryType='arraybuffer';
  stt.onopen=()=>setStatus('Listening — browser → Deepgram → Audio Repeater');
  stt.onmessage=e=>{
    if(typeof e.data!=='string') return;
    try{
      const j=JSON.parse(e.data),text=(j.transcript||'').trim();
      if(text) transcriptEl.textContent=text;
      if(text && j.event==='EndOfTurn') sendTts(text);
    }catch{}
  };
  stt.onerror=()=>setStatus('Deepgram STT error — check the API key');
  stt.onclose=()=>{if(running)setStatus('Deepgram STT disconnected');};
}

function openTts(key){
  if(tts && tts.readyState<=1 && ttsVoice===voiceSelect.value) return;
  try{tts?.close();}catch{}
  ttsVoice=voiceSelect.value;
  const url='wss://api.deepgram.com/v1/speak?model='+encodeURIComponent(ttsVoice)+'&encoding=linear16&sample_rate=48000';
  tts=new WebSocket(url,['token',key]);
  tts.binaryType='arraybuffer';
  tts.onmessage=e=>{if(e.data instanceof ArrayBuffer) playTtsChunk(e.data);};
  tts.onerror=()=>setStatus('Deepgram TTS error — check the API key');
}

function sendTts(text){
  if(!text || !running) return;
  const key=getApiKey(); if(!key) return;
  openTts(key);
  const send=()=>{
    if(tts?.readyState===WebSocket.OPEN){
      tts.send(JSON.stringify({type:'Speak',text:text.slice(0,2000)}));
      tts.send(JSON.stringify({type:'Flush'}));
    }
  };
  if(tts.readyState===WebSocket.OPEN) send();
  else tts.addEventListener('open',send,{once:true});
}

function stopEverything(){
  running=false;
  try{processor?.disconnect();}catch{}
  try{source?.disconnect();}catch{}
  try{analyser?.disconnect();}catch{}
  try{muteGain?.disconnect();}catch{}
  processor=source=analyser=muteGain=null;
  try{inputContext?.close();}catch{}
  inputContext=null;
  try{mediaStream?.getTracks().forEach(t=>t.stop());}catch{}
  mediaStream=null;
  try{stt?.close();}catch{}
  try{tts?.close();}catch{}
  stt=tts=null; ttsVoice=''; ttsQueue=[]; playing=false;
  meterFill.style.width='0%'; setRunning(false); setStatus('Stopped');
}

async function start(){
  if(running) return;
  const key=getApiKey(); if(!key){apiKey.focus();return;}
  if(!window.isSecureContext && location.hostname!=='localhost' && location.hostname!=='127.0.0.1'){
    setStatus('Use HTTPS or localhost for microphone access'); return;
  }
  localStorage.setItem('voicechanger.voice',voiceSelect.value);
  localStorage.setItem('voicechanger.mic',micSelect.value);
  localStorage.setItem('voicechanger.output',outputSelect.value);
  try{
    setStatus('Starting browser audio…');
    mediaStream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:micSelect.value?{exact:micSelect.value}:undefined,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    await enumerateAudio();
    await ensureOutput();
    inputContext=new AudioContext({sampleRate:48000,latencyHint:'interactive'});
    await inputContext.resume();
    source=inputContext.createMediaStreamSource(mediaStream);
    processor=inputContext.createScriptProcessor(4096,1,1);
    analyser=inputContext.createAnalyser(); analyser.fftSize=256;
    muteGain=inputContext.createGain(); muteGain.gain.value=0;
    source.connect(analyser); source.connect(processor); processor.connect(muteGain); muteGain.connect(inputContext.destination);
    const draw=()=>{
      if(!running) return;
      const data=new Uint8Array(analyser.frequencyBinCount); analyser.getByteTimeDomainData(data);
      let sum=0; for(const x of data){const v=(x-128)/128;sum+=v*v;}
      meterFill.style.width=Math.min(100,Math.sqrt(sum/data.length)*170)+'%';
      requestAnimationFrame(draw);
    };
    running=true; setRunning(true); draw();
    openStt(key); openTts(key);
    processor.onaudioprocess=e=>{
      if(!running || !stt || stt.readyState!==WebSocket.OPEN) return;
      const pcm=downsampleFloat32(e.inputBuffer.getChannelData(0),inputContext.sampleRate,16000);
      stt.send(pcm.buffer);
    };
    setStatus('LIVE — TTS is routed to Audio Repeater input');
  }catch(err){
    console.error(err); stopEverything(); setStatus('Audio error: '+(err.message||err));
  }
}

startBtn.onclick=start;
stopBtn.onclick=stopEverything;
outputSelect.onchange=async()=>{
  localStorage.setItem('voicechanger.output',outputSelect.value);
  try{await ensureOutput();setStatus('Output route updated');}catch{setStatus('Could not select the browser output device');}
};
voiceSelect.onchange=()=>{localStorage.setItem('voicechanger.voice',voiceSelect.value);if(running){const key=getApiKey();if(key)openTts(key);}};
apiKey.onchange=()=>{const key=apiKey.value.trim();if(validApiKey(key)){sessionStorage.setItem('voicechanger.key',key);localStorage.setItem('voicechanger.key',key);}};
micSelect.onchange=()=>localStorage.setItem('voicechanger.mic',micSelect.value);
navigator.mediaDevices?.addEventListener?.('devicechange',enumerateAudio);

(async()=>{
  try{await navigator.mediaDevices.getUserMedia({audio:true}).then(s=>s.getTracks().forEach(t=>t.stop()));}catch{}
  try{await enumerateAudio();}catch{setStatus('Could not enumerate audio devices');}
})();
