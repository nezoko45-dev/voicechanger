const $=id=>document.getElementById(id);
const apiKey=$("apiKey"),clearKey=$("clearKey"),reference=$("reference"),output=$("output"),chooseOutput=$("chooseOutput"),player=$("player"),text=$("text"),start=$("start"),stop=$("stop"),status=$("status"),info=$("info");

const TTS_URL="./pocket-tts/index.js";
const DG_URL="wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&punctuate=true&endpointing=300&utterance_end_ms=1000&vad_events=true";

let tts=null,voiceRef=null,running=false;
let dg=null,reconnectTimer=null,keepAliveTimer=null;
let micStream=null,audioContext=null,sourceNode=null,processor=null,gainNode=null;
let recognizing=false,utteranceParts=[],speaking=false,speechQueue=[];

function setStatus(v){status.textContent=v;}

function updateStartButton(){
 const ready=apiKey.value.trim().length>0 && !!reference.files?.[0] && !running;
 start.disabled=!ready;
 if(!running && ready)setStatus("Ready — press START VOICE CHANGER.");
}

async function setOutput(){
 if(player&&typeof player.setSinkId==="function"){
  try{await player.setSinkId(output.value||"");}catch(e){console.warn("setSinkId",e);}
 }
}

async function loadOutputs(){
 if(!navigator.mediaDevices?.enumerateDevices)return;
 try{
  const devices=await navigator.mediaDevices.enumerateDevices();
  const old=output.value;
  output.innerHTML="<option value=''>Default Windows output</option>";
  for(const d of devices.filter(x=>x.kind==="audiooutput")){
   const o=document.createElement("option");
   o.value=d.deviceId;o.textContent=d.label||"Speaker / output "+output.options.length;
   output.appendChild(o);
  }
  if([...output.options].some(x=>x.value===old))output.value=old;
 }catch(e){console.warn(e);}
}

async function chooseChromeSpeaker(){
 if(!navigator.mediaDevices?.selectAudioOutput){
  setStatus("Chrome speaker selection is unavailable here; using the Windows default output.");
  return;
 }
 try{
  const d=await navigator.mediaDevices.selectAudioOutput();
  if(d?.deviceId){
   output.innerHTML="";
   const o=document.createElement("option");
   o.value=d.deviceId;o.textContent=d.label||"Selected Chrome speaker";
   output.appendChild(o);
   await setOutput();
   setStatus("Chrome speaker selected: "+(d.label||"selected output"));
  }
 }catch(e){if(e.name!=="NotAllowedError")setStatus("Speaker picker error: "+e.message);}
}

async function initTTS(){
 if(tts)return;
 setStatus("Loading PocketTTS browser engine and models…");
 const mod=await import(TTS_URL);
 tts=new mod.PocketTTS({language:"english_2026-04",quantized:true,voiceCloning:true,cache:true,maxThreads:8,maxReferenceSeconds:6});
 await tts.load(p=>{
  if(p?.label)setStatus("PocketTTS: "+p.label);
  else if(p?.status)setStatus("PocketTTS: "+p.status);
 });
}

async function decodeReference(file){
 const buf=await file.arrayBuffer();
 const ac=new AudioContext();
 try{
  const decoded=await ac.decodeAudioData(buf);
  return {audio:decoded.getChannelData(0).slice(),sampleRate:decoded.sampleRate};
 }finally{await ac.close();}
}

async function prepareVoice(){
 const file=reference.files?.[0];
 if(!file)throw new Error("Choose a WAV voice reference first.");
 const ref=await decodeReference(file);
 setStatus("Cloning your WAV reference voice…");
 voiceRef=await tts.cloneVoice(ref.audio,{inputSampleRate:ref.sampleRate,name:"deepgram-chrome-clone"});
 setStatus("Voice clone ready. Loading PocketTTS synthesis models…");
 await tts.finishLoad();
 info.textContent="PocketTTS ready at "+tts.sampleRate+" Hz.";
}

function floatToWavBlob(samples,sampleRate){
 const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
 const write=(o,s)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i));};
 write(0,"RIFF");view.setUint32(4,36+samples.length*2,true);write(8,"WAVE");write(12,"fmt ");
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
 view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
 write(36,"data");view.setUint32(40,samples.length*2,true);
 let p=44;
 for(const sample of samples){const s=Math.max(-1,Math.min(1,sample));view.setInt16(p,s<0?s*32768:s*32767,true);p+=2;}
 return new Blob([buffer],{type:"audio/wav"});
}

async function playSamples(samples){
 const blob=floatToWavBlob(samples,tts.sampleRate),url=URL.createObjectURL(blob);
 if(player._blobUrl)URL.revokeObjectURL(player._blobUrl);
 player._blobUrl=url;
 await setOutput();
 player.src=url;player.load();
 try{await player.play();}catch(e){throw new Error("Chrome blocked audio playback. Press the play button once, then speak again.");}
 await new Promise(resolve=>{const done=()=>{player.removeEventListener("ended",done);resolve();};player.addEventListener("ended",done);});
 URL.revokeObjectURL(url);player._blobUrl=null;
}

async function speak(phrase){
 if(!running||!phrase)return;
 speechQueue.push(phrase);
 if(speaking)return;
 speaking=true;
 try{
  while(running&&speechQueue.length){
   const current=speechQueue.shift();
   setStatus("PocketTTS generating: "+current);
   const chunks=[];
   await tts.generate(current,{voice:voiceRef,onChunk:audio=>chunks.push(audio)});
   if(!chunks.length)continue;
   let length=0;for(const c of chunks)length+=c.length;
   const samples=new Float32Array(length);
   let offset=0;for(const c of chunks){samples.set(c,offset);offset+=c.length;}
   setStatus("Playing generated PocketTTS voice…");
   await playSamples(samples);
  }
 }catch(e){
  console.error(e);
  if(running)setStatus("PocketTTS playback error: "+(e.message||e));
 }finally{
  speaking=false;
  if(running)setStatus(recognizing?"Listening — speak naturally.":"Ready.");
 }
}

function makePcm16(float32){
 const pcm=new Int16Array(float32.length);
 for(let i=0;i<float32.length;i++){const x=Math.max(-1,Math.min(1,float32[i]));pcm[i]=x<0?x*32768:x*32767;}
 return pcm.buffer;
}

function closeDeepgram(){
 if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
 if(keepAliveTimer){clearInterval(keepAliveTimer);keepAliveTimer=null;}
 if(dg){try{dg.close();}catch{}dg=null;}
}

function connectDeepgram(){
 if(!running)return;
 const key=apiKey.value.trim();
 if(!key)throw new Error("Enter your Deepgram API key first.");
 closeDeepgram();
 setStatus("Connecting to Deepgram WebSocket…");
 const ws=new WebSocket(DG_URL,["token",key]);
 dg=ws;

 ws.onopen=()=>{
  if(dg!==ws)return;
  recognizing=true;
  setStatus("Deepgram connected — speak naturally.");
  keepAliveTimer=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:"KeepAlive"}));},8000);
 };

 ws.onmessage=event=>{
  if(typeof event.data!=="string")return;
  let msg;try{msg=JSON.parse(event.data);}catch{return;}
  if(msg.type==="SpeechStarted"){setStatus("Listening…");return;}
  if(msg.type!=="Results")return;
  const alt=msg.channel?.alternatives?.[0],phrase=alt?.transcript?.trim()||"";
  if(!phrase)return;
  if(msg.is_final){
   utteranceParts.push(phrase);
   text.value=utteranceParts.join(" ");
  }else{
   text.value=(utteranceParts.length?utteranceParts.join(" ")+ " ":"")+phrase;
  }
  if(msg.speech_final){
   const finalText=utteranceParts.join(" ").replace(/\s+/g," ").trim();
   utteranceParts=[];
   if(finalText)void speak(finalText);
  }
 };

 ws.onerror=()=>{if(running)setStatus("Deepgram WebSocket error — reconnecting…");};
 ws.onclose=()=>{
  if(dg===ws)dg=null;
  recognizing=false;
  if(keepAliveTimer){clearInterval(keepAliveTimer);keepAliveTimer=null;}
  if(running){
   setStatus("Deepgram disconnected — reconnecting…");
   reconnectTimer=setTimeout(()=>{try{connectDeepgram();}catch(e){setStatus(e.message);}},700);
  }
 };
}

async function startMic(){
 if(micStream)return;
 micStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
 await loadOutputs();
 audioContext=new AudioContext({sampleRate:16000});
 sourceNode=audioContext.createMediaStreamSource(micStream);
 processor=audioContext.createScriptProcessor(2048,1,1);
 gainNode=audioContext.createGain();gainNode.gain.value=0;
 sourceNode.connect(processor);processor.connect(gainNode);gainNode.connect(audioContext.destination);
 processor.onaudioprocess=e=>{
  if(!running||!dg||dg.readyState!==WebSocket.OPEN)return;
  dg.send(makePcm16(e.inputBuffer.getChannelData(0)));
 };
 await audioContext.resume();
}

function stopMic(){
 if(processor){processor.onaudioprocess=null;try{processor.disconnect();}catch{}}
 if(sourceNode){try{sourceNode.disconnect();}catch{}}
 if(gainNode){try{gainNode.disconnect();}catch{}}
 processor=null;sourceNode=null;gainNode=null;
 if(audioContext){try{audioContext.close();}catch{}audioContext=null;}
 if(micStream){for(const track of micStream.getTracks())track.stop();micStream=null;}
}

async function startAll(){
 if(running)return;
 try{
  const key=apiKey.value.trim();
  if(!key)throw new Error("Enter your Deepgram API key first.");
  if(!reference.files?.[0])throw new Error("Choose your WAV voice reference first.");
  start.disabled=true;
  setStatus("Starting voice changer…");
  await initTTS();
  await prepareVoice();
  await setOutput();
  running=true;
  stop.disabled=false;
  await startMic();
  connectDeepgram();
 }catch(e){
  console.error(e);running=false;stop.disabled=true;start.disabled=false;
  stopMic();closeDeepgram();setStatus("Start error: "+(e.message||e));updateStartButton();
 }
}

function stopAll(){
 running=false;speechQueue=[];utteranceParts=[];recognizing=false;
 closeDeepgram();stopMic();
 if(tts){try{tts.stop();}catch{}}
 if(player){
  player.pause();player.currentTime=0;
  if(player._blobUrl){URL.revokeObjectURL(player._blobUrl);player._blobUrl=null;}
  player.removeAttribute("src");player.load();
 }
 stop.disabled=true;updateStartButton();
 setStatus("Stopped. Raw microphone audio is never played.");
}

clearKey.onclick=()=>{apiKey.value="";apiKey.focus();updateStartButton();};
apiKey.oninput=updateStartButton;
reference.onchange=()=>{updateStartButton();if(reference.files?.[0])setStatus("WAV selected — enter your Deepgram key, then press START VOICE CHANGER.");};
start.onclick=()=>void startAll();
stop.onclick=stopAll;
chooseOutput.onclick=chooseChromeSpeaker;
output.onchange=()=>void setOutput();
navigator.mediaDevices?.addEventListener?.("devicechange",loadOutputs);
void loadOutputs();

start.disabled=true;
updateStartButton();
