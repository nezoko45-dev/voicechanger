const $ = id => document.getElementById(id);
const apiKey = $('apiKey');
const voiceUuid = $('voiceUuid');
const outputDevice = $('outputDevice');
const outputStatus = $('outputStatus');
const refreshAudioBtn = $('refreshAudio');
const chooseOutputBtn = $('chooseOutput');
const pitch = $('pitch');
const prompt = $('prompt');
const statusEl = $('status');
const transcriptEl = $('text');
const meterFill = $('meterFill');
const startBtn = $('start');
const testAudioBtn = $('testAudio');
const recordBtn = $('record');
const stopBtn = $('stop');
const player = $('player');

const RESEMBLE_API = 'https://app.resemble.ai/api/v2';
const RESEMBLE_SYNTH = 'https://f.cluster.resemble.ai';
let running = false;
let listening = false;
let speaking = false;
let stream = null;
let audioContext = null;
let sourceNode = null;
let processorNode = null;
let silentGain = null;
let recordedChunks = [];
let selectedOutput = 'default';
let speechStarted = false;
let silenceMs = 0;
let speechMs = 0;
let lastProcessTime = 0;
let processingPromise = null;

function setStatus(text){ statusEl.textContent = text; }
function setRunning(v){
  running = v;
  startBtn.disabled = v;
  testAudioBtn.disabled = !v;
  recordBtn.disabled = !v;
  stopBtn.disabled = !v;
  recordBtn.textContent = 'Start Automatic Voice Changer';
}
function requireKey(){
  const key = apiKey.value.trim();
  if(!key) throw new Error('Enter your Resemble API key first.');
  return key;
}
async function resemble(path, options = {}){
  const key = requireKey();
  const response = await fetch(RESEMBLE_API + path, {
    ...options,
    headers: { Authorization:`Bearer ${key}`, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if(!response.ok) throw new Error(data.error || data.message || data.detail || `Resemble HTTP ${response.status}`);
  return data;
}
async function loadAudioDevices(){
  if(!navigator.mediaDevices?.enumerateDevices) { outputStatus.textContent='This browser does not expose audio output selection.'; return; }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter(d => d.kind === 'audiooutput');
  const previous = selectedOutput || 'default';
  outputDevice.innerHTML = '';
  outputDevice.add(new Option('Default Windows output','default'));
  outputs.forEach(device => {
    if(!device.deviceId) return;
    const label = /cable input|vb-audio cable|virtual audio cable/i.test(device.label || '') ? 'VB-CABLE — CABLE Input' : (device.label || 'Audio output');
    outputDevice.add(new Option(label, device.deviceId));
  });
  if(previous !== 'default' && [...outputDevice.options].some(o => o.value === previous)) outputDevice.value = previous;
  else {
    const cable = outputs.find(d => /cable input|vb-audio cable|virtual audio cable/i.test(d.label || ''));
    outputDevice.value = cable?.deviceId || 'default';
  }
  selectedOutput = outputDevice.value || 'default';
  outputStatus.textContent = `Browser TTS output: ${outputDevice.selectedOptions[0]?.text || 'Default Windows output'}`;
  await applySink(false);
}
async function applySink(){
  selectedOutput = outputDevice.value || 'default';
  try{
    if(typeof player.setSinkId === 'function') await player.setSinkId(selectedOutput === 'default' ? '' : selectedOutput);
    outputStatus.textContent = `Browser TTS output: ${outputDevice.selectedOptions[0]?.text || 'Default Windows output'}`;
  }catch(err){ outputStatus.textContent = `Could not select that output: ${err.message}`; }
}
async function chooseOutput(){
  try{
    if(typeof navigator.mediaDevices.selectAudioOutput !== 'function') { await loadAudioDevices(); setStatus('Choose an output from the list'); return; }
    const device = await navigator.mediaDevices.selectAudioOutput();
    if(device?.deviceId){ selectedOutput=device.deviceId; await loadAudioDevices(); outputDevice.value=device.deviceId; await applySink(); setStatus(`Output selected: ${device.label || 'Windows audio device'}`); }
  }catch(err){ setStatus('Output chooser: ' + err.message); }
}
function decodeBase64Audio(base64,mime='audio/wav'){
  if(!base64) throw new Error('Resemble returned no audio data.');
  const chars=atob(base64), bytes=new Uint8Array(chars.length);
  for(let i=0;i<chars.length;i++) bytes[i]=chars.charCodeAt(i);
  return new Blob([bytes],{type:mime});
}
async function playResembleAudio(base64,mime='audio/wav'){
  const blob=decodeBase64Audio(base64,mime), url=URL.createObjectURL(blob);
  try{
    if(typeof player.setSinkId==='function') await player.setSinkId(selectedOutput==='default'?'':selectedOutput);
    player.src=url; player.currentTime=0; speaking=true; await player.play();
    await new Promise(resolve=>{ const done=()=>{player.removeEventListener('ended',done);resolve();}; player.addEventListener('ended',done); setTimeout(()=>{player.removeEventListener('ended',done);resolve();},30000); });
  }finally{ speaking=false; URL.revokeObjectURL(url); }
}
async function loadVoices(){
  setStatus('Loading your Resemble custom voices…');
  const data=await resemble('/voices'), previous=voiceUuid.value;
  voiceUuid.innerHTML=''; const voices=data.items || data.voices || [];
  if(!voices.length) throw new Error('No Resemble voices were returned for this account.');
  voices.forEach(v=>voiceUuid.add(new Option(`${v.name || 'Unnamed'} — ${v.uuid || ''}`,v.uuid || '')));
  if(previous && [...voiceUuid.options].some(o=>o.value===previous)) voiceUuid.value=previous;
  if(!voiceUuid.value && voices[0]?.uuid) voiceUuid.value=voices[0].uuid;
}
async function connect(){
  try{
    requireKey(); setStatus('Requesting browser microphone permission…');
    const permissionStream=await navigator.mediaDevices.getUserMedia({audio:true}); permissionStream.getTracks().forEach(t=>t.stop());
    await loadAudioDevices(); await loadVoices(); if(!voiceUuid.value.trim()) throw new Error('No Resemble custom voice is selected.');
    setRunning(true); setStatus('Resemble browser mode ready');
    transcriptEl.textContent='Ready. Start the automatic voice changer and just talk — no Stop button is needed between sentences.'; meterFill.style.width='20%';
  }catch(err){ setRunning(false); setStatus('Connection error: '+err.message); transcriptEl.textContent=err.message; }
}
async function synthesize(text){
  const response=await fetch(`${RESEMBLE_SYNTH}/synthesize`,{
    method:'POST',headers:{Authorization:`Bearer ${requireKey()}`,'Content-Type':'application/json'},
    body:JSON.stringify({voice_uuid:voiceUuid.value.trim(),data:text,output_format:'wav',sample_rate:48000})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error || data.message || `Resemble TTS HTTP ${response.status}`);
  return data;
}
async function testAudio(){
  if(!running) return;
  try{
    if(!voiceUuid.value.trim()) throw new Error('Select a Resemble custom voice first.');
    setStatus('Resemble TTS: generating test voice…'); meterFill.style.width='55%';
    const data=await synthesize('Hello! This is the Resemble browser voice test.');
    await playResembleAudio(data.audio_content,'audio/wav'); meterFill.style.width='100%'; setStatus('Test audio played successfully');
    transcriptEl.textContent='TTS works directly in the browser. If CABLE Input is selected, the audio is routed into VB-CABLE.';
  }catch(err){ meterFill.style.width='0%'; setStatus('Audio test failed: '+err.message); transcriptEl.textContent=err.message; }
}
function mergeFloat32(chunks,length){ const output=new Float32Array(length); let offset=0; for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;} return output; }
function encodeWav(samples,sampleRate){
  const buffer=new ArrayBuffer(44+samples.length*2), view=new DataView(buffer);
  const writeString=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
  writeString(0,'RIFF');view.setUint32(4,36+samples.length*2,true);writeString(8,'WAVE');writeString(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);writeString(36,'data');view.setUint32(40,samples.length*2,true);
  let offset=44; for(let i=0;i<samples.length;i++){const sample=Math.max(-1,Math.min(1,samples[i]));view.setInt16(offset,sample<0?sample*0x8000:sample*0x7fff,true);offset+=2;} return new Blob([buffer],{type:'audio/wav'});
}
function rms(samples){let sum=0;for(let i=0;i<samples.length;i++)sum+=samples[i]*samples[i];return Math.sqrt(sum/Math.max(1,samples.length));}
async function transcribeAndSpeak(wav){
  if(processingPromise)return processingPromise;
  processingPromise=(async()=>{
    try{
      setStatus('Resemble STT: transcribing…'); transcriptEl.textContent='Speech captured — Resemble is transcribing automatically…'; meterFill.style.width='55%';
      const form=new FormData();form.append('file',wav,'voice.wav');
      const created=await resemble('/speech-to-text',{method:'POST',body:form}); const uuid=created.item?.uuid;
      if(!uuid)throw new Error('Resemble STT did not return a transcript UUID.');
      let text='';
      for(let attempt=0;attempt<30;attempt++){
        await new Promise(r=>setTimeout(r,500)); const result=await resemble(`/speech-to-text/${encodeURIComponent(uuid)}`); const item=result.item||{};
        if(item.status==='failed'||item.status==='error')throw new Error('Resemble STT failed to process the audio.');
        if(item.text && item.status==='completed'){text=item.text.trim();break;}
      }
      if(!text){setStatus('Listening again…');return;}
      transcriptEl.textContent=text; setStatus('Resemble TTS: repeating your speech…');
      const data=await synthesize(text); await playResembleAudio(data.audio_content,'audio/wav'); meterFill.style.width='100%'; setStatus('Listening again…');
    }catch(err){setStatus('Automatic voice error: '+err.message);transcriptEl.textContent=err.message;meterFill.style.width='0%';}
    finally{processingPromise=null;}
  })();
  return processingPromise;
}
async function startAutomaticVoiceChanger(){
  if(!running||listening)return;
  try{
    requireKey();if(!voiceUuid.value.trim())throw new Error('Select a Resemble custom voice first.');
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    audioContext=new (window.AudioContext||window.webkitAudioContext)();await audioContext.resume();
    sourceNode=audioContext.createMediaStreamSource(stream);processorNode=audioContext.createScriptProcessor(2048,1,1);silentGain=audioContext.createGain();silentGain.gain.value=0;
    sourceNode.connect(processorNode);processorNode.connect(silentGain);silentGain.connect(audioContext.destination);
    recordedChunks=[];speechStarted=false;silenceMs=0;speechMs=0;lastProcessTime=performance.now();listening=true;recordBtn.textContent='Automatic Listening…';setStatus('Listening… talk normally');transcriptEl.textContent='Speak naturally. The browser detects when you stop talking and automatically sends the sentence to Resemble.';meterFill.style.width='25%';
    processorNode.onaudioprocess=event=>{
      if(!listening||speaking||processingPromise)return; const input=event.inputBuffer.getChannelData(0),copy=new Float32Array(input.length);copy.set(input);
      const level=rms(input),now=performance.now(),dt=Math.max(1,Math.min(100,now-lastProcessTime));lastProcessTime=now;const threshold=0.018;
      if(level>threshold){speechStarted=true;speechMs+=dt;silenceMs=0;recordedChunks.push(copy);meterFill.style.width=`${Math.min(70,25+level*900)}%`;}
      else if(speechStarted){recordedChunks.push(copy);silenceMs+=dt;speechMs+=dt;if(silenceMs>=750&&speechMs>=350){const chunks=recordedChunks;recordedChunks=[];speechStarted=false;silenceMs=0;speechMs=0;const total=chunks.reduce((n,c)=>n+c.length,0);transcribeAndSpeak(encodeWav(mergeFloat32(chunks,total),audioContext.sampleRate));}}
    };
  }catch(err){await stopAutomaticVoiceChanger();setStatus('Microphone error: '+err.message);transcriptEl.textContent=err.message;}
}
async function stopAutomaticVoiceChanger(){
  listening=false;speechStarted=false;silenceMs=0;speechMs=0;recordedChunks=[];
  if(processorNode){try{processorNode.disconnect();}catch{}} if(sourceNode){try{sourceNode.disconnect();}catch{}} if(silentGain){try{silentGain.disconnect();}catch{}}
  if(stream)stream.getTracks().forEach(t=>t.stop());if(audioContext){try{await audioContext.close();}catch{}}
  processorNode=null;sourceNode=null;silentGain=null;stream=null;audioContext=null;if(running)recordBtn.textContent='Start Automatic Voice Changer';
}
async function stop(){await stopAutomaticVoiceChanger();setRunning(false);meterFill.style.width='0%';setStatus('Stopped');}
startBtn.onclick=connect;testAudioBtn.onclick=testAudio;recordBtn.onclick=()=>listening?stopAutomaticVoiceChanger():startAutomaticVoiceChanger();stopBtn.onclick=stop;chooseOutputBtn.onclick=chooseOutput;refreshAudioBtn.onclick=async()=>{try{await loadAudioDevices();setStatus('Browser audio outputs refreshed');}catch(err){setStatus('Audio output error: '+err.message);}};outputDevice.onchange=applySink;
(async()=>{setRunning(false);try{await loadAudioDevices();}catch{}})();
