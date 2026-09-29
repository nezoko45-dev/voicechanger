const $=id=>document.getElementById(id);
const reference=$("reference"),output=$("output"),chooseOutput=$("chooseOutput"),text=$("text"),start=$("start"),stop=$("stop"),status=$("status"),info=$("info");

const TTS_URL="./pocket-tts/index.js";
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;

let tts=null,voiceRef=null,ttsPlayer=null,running=false;
let recognition=null,speaking=false,speechQueue=[];
let reconnectTimer=null,reconnectDelay=250,reconnectGeneration=0;

function setStatus(v){status.textContent=v;}

function updateStartButton(){
 const ready=!!reference.files?.[0]&&!running;
 start.disabled=!ready;
 if(!running&&ready)setStatus("Ready — press START POCKETTTS.");
}

async function setOutput(){
 if(ttsPlayer?.setSinkId){
  try{await ttsPlayer.setSinkId(output.value||"");}
  catch(e){console.warn("PocketTTS output device",e);}
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
 }catch(e){
  if(e.name!=="NotAllowedError")setStatus("Speaker picker error: "+e.message);
 }
}

async function initTTS(){
 if(tts)return;
 setStatus("Loading PocketTTS models…");
 const mod=await import(TTS_URL);
 tts=new mod.PocketTTS({
  language:"english_2026-04",
  quantized:true,
  voiceCloning:true,
  cache:true,
  maxThreads:8,
  maxReferenceSeconds:6
 });
 ttsPlayer=new mod.StreamingPlayer({sampleRate:tts.sampleRate});
 await ttsPlayer.resume();
 await tts.load(p=>{
  if(p?.label)setStatus("PocketTTS: "+p.label);
  else if(p?.status)setStatus("PocketTTS: "+p.status);
 });
 await setOutput();
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
 setStatus("Cloning your WAV voice…");
 voiceRef=await tts.cloneVoice(ref.audio,{inputSampleRate:ref.sampleRate,name:"pockettts-clone"});
 setStatus("Voice clone ready. Loading synthesis models…");
 await tts.finishLoad();
 info.textContent="PocketTTS ready at "+tts.sampleRate+" Hz. No Deepgram is used.";
}

async function speak(phrase){
 if(!running||!phrase)return;
 speechQueue.push(phrase);
 if(speaking)return;
 speaking=true;
 try{
  while(running&&speechQueue.length){
   const current=speechQueue.shift();
   setStatus("PocketTTS speaking: "+current);
   await tts.generate(current,{
    voice:voiceRef,
    onChunk:(audio,meta)=>{
     if(running)ttsPlayer.play(audio,meta);
    }
   });
   if(running)ttsPlayer.flush();
  }
 }catch(e){
  console.error(e);
  if(running)setStatus("PocketTTS error: "+(e.message||e));
 }finally{
  speaking=false;
  if(running)setStatus("Listening — speak naturally.");
 }
}

function cancelRecognitionReconnect(){
 if(reconnectTimer){
  clearTimeout(reconnectTimer);
  reconnectTimer=null;
 }
}

function createRecognition(){
 if(!SpeechRecognition)throw new Error("Chrome Speech Recognition is unavailable in this browser. Use Google Chrome on Windows.");

 const r=new SpeechRecognition();
 r.continuous=true;
 r.interimResults=true;
 r.lang="en-US";
 r.maxAlternatives=1;

 r.onstart=()=>{
  if(r!==recognition)return;
  reconnectDelay=250;
  if(running)setStatus("Listening — speak naturally.");
 };

 r.onresult=event=>{
  if(r!==recognition)return;
  let interim="";
  const finals=[];
  for(let i=event.resultIndex;i<event.results.length;i++){
   const result=event.results[i];
   const phrase=result[0]?.transcript?.trim()||"";
   if(!phrase)continue;
   if(result.isFinal)finals.push(phrase);
   else interim+=phrase+" ";
  }
  if(finals.length){
   text.value=(text.value+" "+finals.join(" ")).trim();
   for(const phrase of finals)void speak(phrase);
  }
  if(interim){
   text.dataset.interim=interim.trim();
  }else{
   text.dataset.interim="";
  }
 };

 r.onerror=event=>{
  if(r!==recognition||!running)return;
  console.warn("Chrome Speech Recognition error:",event.error);

  if(event.error==="not-allowed"||event.error==="service-not-allowed"){
   setStatus("Microphone permission/service denied. Allow Chrome microphone access, then it will reconnect.");
   scheduleRecognitionReconnect();
   return;
  }

  if(event.error==="audio-capture"){
   setStatus("Microphone capture stopped — reconnecting Chrome speech recognition…");
  }else if(event.error==="network"){
   setStatus("Chrome speech service disconnected — reconnecting…");
  }else if(event.error==="no-speech"){
   setStatus("No speech detected — keeping Chrome speech recognition connected…");
  }else if(event.error!=="aborted"){
   setStatus("Speech recognition: "+event.error+" — reconnecting…");
  }
 };

 r.onend=()=>{
  if(r!==recognition||!running)return;
  scheduleRecognitionReconnect();
 };

 return r;
}

function scheduleRecognitionReconnect(){
 if(!running||reconnectTimer)return;
 const delay=Math.min(reconnectDelay,5000);
 setStatus("Chrome speech session stopped — reconnecting in "+(delay/1000).toFixed(1)+"s…");
 const generation=++reconnectGeneration;
 reconnectTimer=setTimeout(()=>{
  reconnectTimer=null;
  if(!running||generation!==reconnectGeneration)return;
  try{
   if(recognition){
    recognition.onend=null;
    recognition.onerror=null;
    try{recognition.abort();}catch{}
   }
   recognition=createRecognition();
   recognition.start();
   reconnectDelay=Math.min(Math.max(reconnectDelay*1.5,500),5000);
  }catch(e){
   console.warn("Chrome recognition reconnect failed:",e);
   reconnectDelay=Math.min(Math.max(reconnectDelay*1.5,500),5000);
   scheduleRecognitionReconnect();
  }
 },delay);
}

async function startAll(){
 if(running)return;
 try{
  if(!reference.files?.[0])throw new Error("Choose your WAV voice reference first.");
  if(!SpeechRecognition)throw new Error("Chrome Speech Recognition is unavailable in this browser.");
  start.disabled=true;
  setStatus("Starting PocketTTS…");
  await initTTS();
  await prepareVoice();
  await loadOutputs();
  await setOutput();

  cancelRecognitionReconnect();
  reconnectDelay=250;
  reconnectGeneration++;
  running=true;
  stop.disabled=false;
  recognition=createRecognition();
  recognition.start();
 }catch(e){
  console.error(e);
  running=false;
  stop.disabled=true;
  cancelRecognitionReconnect();
  if(recognition){try{recognition.abort();}catch{}recognition=null;}
  if(ttsPlayer){try{await ttsPlayer.destroy();}catch{}ttsPlayer=null;}
  setStatus("Start error: "+(e.message||e));
  updateStartButton();
 }
}

async function stopAll(){
 running=false;
 reconnectGeneration++;
 cancelRecognitionReconnect();
 speechQueue=[];
 if(recognition){
  try{recognition.onend=null;recognition.onerror=null;recognition.abort();}catch{}
  recognition=null;
 }
 if(tts){try{await tts.stop();}catch{}}
 if(ttsPlayer){try{await ttsPlayer.destroy();}catch{}ttsPlayer=null;}
 stop.disabled=true;
 updateStartButton();
 setStatus("Stopped. Raw microphone audio is never played.");
}

reference.onchange=()=>{
 updateStartButton();
 if(reference.files?.[0])setStatus("WAV selected — press START POCKETTTS.");
};
start.onclick=()=>void startAll();
stop.onclick=()=>void stopAll();
chooseOutput.onclick=chooseChromeSpeaker;
output.onchange=()=>void setOutput();
navigator.mediaDevices?.addEventListener?.("devicechange",loadOutputs);
void loadOutputs();

start.disabled=true;
updateStartButton();
