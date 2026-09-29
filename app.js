const $=id=>document.getElementById(id);
const reference=$("reference"),output=$("output"),chooseOutput=$("chooseOutput"),text=$("text"),start=$("start"),micBtn=$("micBtn"),stop=$("stop"),status=$("status"),info=$("info");
let tts=null,voiceRef=null,running=false,playback=null,recognition=null,recognizing=false;

const TTS_URL="./pocket-tts/index.js";

function setStatus(v){status.textContent=v;}

function createPlayback(){
 const sink=output?.value||"";
 try{return sink?new AudioContext({latencyHint:"interactive",sinkId:sink}):new AudioContext({latencyHint:"interactive"});}
 catch{return new AudioContext({latencyHint:"interactive"});}
}

async function setOutput(){
 if(playback&&typeof playback.setSinkId==="function"){
  try{await playback.setSinkId(output.value||"");}catch(e){console.warn("setSinkId",e);}
 }
}

async function loadOutputs(){
 if(!navigator.mediaDevices?.enumerateDevices)return;
 try{
  const devices=await navigator.mediaDevices.enumerateDevices();
  const oldOut=output.value;
  output.innerHTML="<option value=''>Default Windows output</option>";
  for(const d of devices.filter(x=>x.kind==="audiooutput")){
   const o=document.createElement("option");
   o.value=d.deviceId;
   o.textContent=d.label||"Speaker / output "+output.options.length;
   output.appendChild(o);
  }
  if([...output.options].some(x=>x.value===oldOut))output.value=oldOut;
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
   o.value=d.deviceId;
   o.textContent=d.label||"Selected Chrome speaker";
   output.appendChild(o);
   await setOutput();
   setStatus("Chrome speaker selected: "+(d.label||"selected output"));
  }
 }catch(e){if(e.name!=="NotAllowedError")setStatus("Speaker picker error: "+e.message);}
}

async function decodeReference(file){
 const buf=await file.arrayBuffer();
 const ac=new AudioContext();
 try{
  const decoded=await ac.decodeAudioData(buf);
  return {audio:decoded.getChannelData(0).slice(),sampleRate:decoded.sampleRate};
 }finally{await ac.close();}
}

async function initTTS(){
 if(tts)return;
 setStatus("Loading PocketTTS browser engine and models…");
 const mod=await import(TTS_URL);
 tts=new mod.PocketTTS({language:"english_2026-04",quantized:true,voiceCloning:true,cache:true,maxThreads:8});
 await tts.load(p=>{
  if(p?.label)setStatus("PocketTTS: "+p.label);
  else if(p?.status)setStatus("PocketTTS: "+p.status);
 });
 setStatus("PocketTTS loaded. Preparing synthesis…");
 await tts.finishLoad();
 info.textContent="PocketTTS sample rate: "+tts.sampleRate+" Hz";
}

async function prepareVoice(){
 const file=reference.files?.[0];
 if(!file)throw new Error("Choose a voice reference WAV/audio file first.");
 const ref=await decodeReference(file);
 setStatus("Cloning reference voice…");
 voiceRef=await tts.cloneVoice(ref.audio,{inputSampleRate:ref.sampleRate,name:"chrome-clone"});
 setStatus("Voice clone ready.");
}

async function playChunk(audio){
 if(!playback)playback=createPlayback();
 await playback.resume();
 await setOutput();
 const buffer=playback.createBuffer(1,audio.length,tts.sampleRate);
 buffer.copyToChannel(audio,0);
 const node=playback.createBufferSource();
 node.buffer=buffer;
 node.connect(playback.destination);
 const now=playback.currentTime;
 const at=Math.max(now,playChunk.nextAt||now);
 node.start(at);
 playChunk.nextAt=at+buffer.duration;
}

async function speak(value){
 if(!running)return;
 const phrase=value.trim();
 if(!phrase)return;
 playChunk.nextAt=playback?.currentTime||0;
 setStatus("PocketTTS speaking…");
 const localQueue=[];
 await tts.generate(phrase,{voice:voiceRef,onChunk:audio=>localQueue.push(audio)});
 for(const audio of localQueue)await playChunk(audio);
 if(running)setStatus("Ready — speak or type another sentence.");
}

async function startTTS(){
 try{
  start.disabled=true;
  micBtn.disabled=true;
  await initTTS();
  await prepareVoice();
  if(!playback)playback=createPlayback();
  await playback.resume();
  await setOutput();
  running=true;
  stop.disabled=false;
  setStatus("PocketTTS ready — browser speech recognition feeds text into the cloned WAV voice.");
  const value=text.value.trim();
  if(value)await speak(value);
 }catch(e){
  console.error(e);
  setStatus("PocketTTS error: "+(e.message||e));
  start.disabled=false;
  micBtn.disabled=false;
 }
}

function stopAll(){
 running=false;
 recognizing=false;
 if(recognition){try{recognition.stop();}catch{}}
 recognition=null;
 if(tts){try{tts.stop();}catch{}}
 if(playback){try{void playback.suspend();}catch{}}
 stop.disabled=true;
 start.disabled=false;
 micBtn.disabled=false;
 micBtn.textContent="START MIC";
 setStatus("Stopped. This app has no microphone audio playback path.");
}

function startMic(){
 if(!running){setStatus("Start PocketTTS first.");return;}
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR){setStatus("Chrome speech recognition is unavailable in this browser.");return;}
 if(recognizing)return;

 recognition=new SR();
 recognition.continuous=true;
 recognition.interimResults=false;
 recognition.lang="en-US";

 recognition.onstart=()=>{
  recognizing=true;
  micBtn.textContent="MIC LISTENING";
  setStatus("Listening for speech only — mic audio is NOT routed to Chrome output.");
 };

 recognition.onerror=e=>{
  recognizing=false;
  micBtn.textContent="START MIC";
  setStatus("Speech recognition error: "+e.error);
 };

 recognition.onend=()=>{
  recognizing=false;
  micBtn.textContent="START MIC";
  if(running)setStatus("Speech recognition stopped. Press START MIC to listen again.");
 };

 recognition.onresult=async e=>{
  const last=e.results[e.results.length-1];
  const phrase=last?.[0]?.transcript?.trim();
  if(!phrase||!running)return;
  text.value=phrase;
  setStatus("Recognized: "+phrase+" — sending text to PocketTTS…");
  await speak(phrase);
 };

 recognition.start();
}

text.addEventListener("keydown",e=>{
 if((e.ctrlKey||e.metaKey)&&e.key==="Enter")void speak(text.value);
});

start.onclick=()=>void startTTS();
stop.onclick=stopAll;
micBtn.onclick=startMic;
chooseOutput.onclick=chooseChromeSpeaker;
output.onchange=()=>void setOutput();
navigator.mediaDevices?.addEventListener?.("devicechange",loadOutputs);
void loadOutputs();
