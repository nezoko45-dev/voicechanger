const $=id=>document.getElementById(id);
const reference=$("reference"),output=$("output"),chooseOutput=$("chooseOutput"),text=$("text"),start=$("start"),stop=$("stop"),status=$("status"),info=$("info");
const TTS_URL="./pocket-tts/index.js";

let tts=null,voiceRef=null,ttsPlayer=null,running=false,ttsBusy=false,ttsQueue=[];
let recognition=null,restartTimer=null;

function setStatus(v){status.textContent=v;}
function updateStartButton(){start.disabled=!(reference.files?.[0]&&!running);}

async function setOutput(){
 if(ttsPlayer?.setSinkId){
  try{await ttsPlayer.setSinkId(output.value||"");}catch(e){console.warn(e);}
 }
}
async function loadOutputs(){
 if(!navigator.mediaDevices?.enumerateDevices)return;
 try{
  const devices=await navigator.mediaDevices.enumerateDevices(),old=output.value;
  output.innerHTML="<option value=''>Default Windows output</option>";
  devices.filter(d=>d.kind==="audiooutput").forEach(d=>{
   const o=document.createElement("option");
   o.value=d.deviceId;o.textContent=d.label||"Speaker / output "+output.options.length;
   output.appendChild(o);
  });
  if([...output.options].some(o=>o.value===old))output.value=old;
 }catch(e){console.warn(e);}
}
async function chooseChromeSpeaker(){
 if(!navigator.mediaDevices?.selectAudioOutput){
  setStatus("Chrome speaker picker unavailable; using default output.");return;
 }
 try{
  const d=await navigator.mediaDevices.selectAudioOutput();
  if(d?.deviceId){
   output.innerHTML="";
   const o=document.createElement("option");
   o.value=d.deviceId;o.textContent=d.label||"Selected Chrome speaker";
   output.appendChild(o);
   await setOutput();setStatus("Speaker selected.");
  }
 }catch(e){if(e.name!=="NotAllowedError")setStatus("Speaker picker error: "+e.message);}
}

async function initTTS(){
 if(tts)return;
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
 setStatus("Loading PocketTTS models…");
 await tts.load(p=>{
  if(p?.label){
   const pct=p.total?Math.round(p.loaded/p.total*100):"";
   setStatus("PocketTTS: "+p.label+(pct!==""?" "+pct+"%":""));
  }
 });
 await setOutput();
}

async function prepareVoice(){
 const file=reference.files?.[0];
 if(!file)throw new Error("Choose a WAV voice reference first.");
 const buf=await file.arrayBuffer();
 const ac=new AudioContext();
 try{
  const decoded=await ac.decodeAudioData(buf);
  if(decoded.numberOfChannels<1)throw new Error("The WAV has no audio channel.");
  const mono=decoded.getChannelData(0).slice();
  setStatus("Cloning WAV voice…");
  voiceRef=await tts.cloneVoice(mono,{inputSampleRate:decoded.sampleRate,name:"pockettts-mic-clone"});
 }finally{await ac.close();}
 await tts.finishLoad();
 info.textContent="Chrome mic → Speech Recognition → PocketTTS → selected speaker.";
}

async function speak(phrase){
 phrase=phrase.trim();
 if(!running||!phrase)return;
 ttsQueue.push(phrase);
 if(ttsBusy)return;
 ttsBusy=true;
 try{
  while(running&&ttsQueue.length){
   const current=ttsQueue.shift();
   text.value=current;
   setStatus("PocketTTS speaking…");
   await tts.generate(current,{
    voice:voiceRef,
    onChunk:(audio,meta)=>{if(running)ttsPlayer.play(audio,meta);}
   });
   if(running)ttsPlayer.flush();
  }
 }catch(e){
  console.error(e);
  if(running)setStatus("PocketTTS error: "+(e.message||e));
 }finally{
  ttsBusy=false;
  if(running)setStatus("Listening…");
 }
}

function startRecognition(){
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR)throw new Error("Chrome Speech Recognition is unavailable. Use Google Chrome.");

 recognition=new SR();
 recognition.lang="en-US";
 recognition.continuous=true;
 recognition.interimResults=true;
 recognition.maxAlternatives=1;

 recognition.onstart=()=>setStatus("Listening — speak now.");
 recognition.onresult=e=>{
  for(let i=e.resultIndex;i<e.results.length;i++){
   const result=e.results[i];
   const phrase=result[0]?.transcript?.trim();
   if(!phrase)continue;
   text.value=phrase;
   if(result.isFinal)void speak(phrase);
  }
 };
 recognition.onerror=e=>{
  console.warn("SpeechRecognition:",e.error);
  if(e.error==="not-allowed"||e.error==="service-not-allowed"){
   setStatus("Chrome speech recognition permission was denied.");
   return;
  }
  if(running)setStatus("Speech recognition reconnecting…");
 };
 recognition.onend=()=>{
  if(!running)return;
  clearTimeout(restartTimer);
  restartTimer=setTimeout(()=>{
   if(running){
    try{recognition.start();}catch(e){}
   }
  },100);
 };
 recognition.start();
}

function stopRecognition(){
 clearTimeout(restartTimer);restartTimer=null;
 try{recognition?.stop();}catch(e){}
 recognition=null;
}

async function startAll(){
 if(running)return;
 try{
  if(!reference.files?.[0])throw new Error("Choose your WAV voice reference first.");
  start.disabled=true;
  running=true;
  stop.disabled=false;
  text.value="";
  setStatus("Starting microphone…");
  startRecognition();
  setStatus("Listening… PocketTTS is preparing your voice.");
  await initTTS();
  if(!running)return;
  await prepareVoice();
  if(!running)return;
  await loadOutputs();
  await setOutput();
  if(running)setStatus("Listening — speak now.");
 }catch(e){
  console.error(e);
  running=false;
  stopRecognition();
  if(ttsPlayer){try{ttsPlayer.destroy();}catch{}ttsPlayer=null;}
  setStatus("Start error: "+(e.message||e));
  updateStartButton();
 }finally{
  if(!running)stop.disabled=true;
 }
}

async function stopAll(){
 running=false;
 stopRecognition();
 ttsQueue=[];
 if(tts){try{await tts.stop();}catch{}}
 if(ttsPlayer){try{ttsPlayer.destroy();}catch{}ttsPlayer=null;}
 stop.disabled=true;
 updateStartButton();
 setStatus("Stopped. Raw microphone audio is never played.");
}

reference.onchange=updateStartButton;
start.onclick=()=>void startAll();
stop.onclick=()=>void stopAll();
chooseOutput.onclick=chooseChromeSpeaker;
output.onchange=()=>void setOutput();
navigator.mediaDevices?.addEventListener?.("devicechange",loadOutputs);
void loadOutputs();
updateStartButton();
