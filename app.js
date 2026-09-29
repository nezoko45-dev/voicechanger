const $=id=>document.getElementById(id);
const reference=$("reference"),output=$("output"),chooseOutput=$("chooseOutput"),text=$("text"),start=$("start"),micBtn=$("micBtn"),stop=$("stop"),status=$("status"),info=$("info"),player=$("player");
let tts=null,voiceRef=null,running=false,recognition=null,recognizing=false,recognitionWanted=false,speaking=false,speechQueue=[];
const TTS_URL="./pocket-tts/index.js";

function setStatus(v){status.textContent=v;}

async function setOutput(){
 if(player&&typeof player.setSinkId==="function"){
  try{await player.setSinkId(output.value||"");}catch(e){console.warn("setSinkId",e);}
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
 if(!file)throw new Error("Choose a voice reference WAV/audio file first.");
 const ref=await decodeReference(file);
 setStatus("Cloning reference voice…");
 voiceRef=await tts.cloneVoice(ref.audio,{inputSampleRate:ref.sampleRate,name:"chrome-clone"});
 setStatus("Voice clone ready.");
}

function floatToWavBlob(samples,sampleRate){
 const buffer=new ArrayBuffer(44+samples.length*2);
 const view=new DataView(buffer);
 const write=(offset,s)=>{for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i));};
 write(0,"RIFF");view.setUint32(4,36+samples.length*2,true);write(8,"WAVE");write(12,"fmt ");
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
 view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
 write(36,"data");view.setUint32(40,samples.length*2,true);
 let p=44;
 for(const sample of samples){
  const s=Math.max(-1,Math.min(1,sample));
  view.setInt16(p,s<0?s*32768:s*32767,true);p+=2;
 }
 return new Blob([buffer],{type:"audio/wav"});
}

async function playSamples(samples){
 if(!player)throw new Error("Audio player is missing.");
 await setOutput();
 const blob=floatToWavBlob(samples,tts.sampleRate);
 const url=URL.createObjectURL(blob);
 if(player._blobUrl)URL.revokeObjectURL(player._blobUrl);
 player._blobUrl=url;
 player.src=url;
 player.load();
 try{await player.play();}catch(e){throw new Error("Chrome audio playback was blocked. Press play on the audio player once, then try again.");}
 await new Promise(resolve=>{
  const done=()=>{player.removeEventListener("ended",done);resolve();};
  player.addEventListener("ended",done);
 });
 URL.revokeObjectURL(url);
 player._blobUrl=null;
}

async function speak(value){
 if(!running)return;
 const phrase=value.trim();
 if(!phrase)return;
 speechQueue.push(phrase);
 if(speaking)return;
 speaking=true;
 try{
  while(speechQueue.length&&running){
   const current=speechQueue.shift();
   setStatus("PocketTTS generating: "+current);
   const chunks=[];
   await tts.generate(current,{voice:voiceRef,onChunk:audio=>chunks.push(audio)});
   if(!chunks.length)continue;
   let length=0;
   for(const c of chunks)length+=c.length;
   const samples=new Float32Array(length);
   let offset=0;
   for(const c of chunks){samples.set(c,offset);offset+=c.length;}
   setStatus("Playing PocketTTS voice…");
   await playSamples(samples);
  }
 }finally{
  speaking=false;
  if(running)setStatus(recognizing?"Listening — speak naturally.":"Ready — press START MIC to speak.");
 }
}

function stopRecognition(){
 recognitionWanted=false;
 if(recognition){try{recognition.onend=null;recognition.stop();}catch{}}
 recognition=null;
 recognizing=false;
 micBtn.textContent="START MIC";
}

function startMic(){
 if(!running){setStatus("Start PocketTTS first.");return;}
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR){setStatus("Chrome Speech Recognition is unavailable in this browser.");return;}
 if(recognitionWanted)return;
 recognitionWanted=true;

 const launch=()=>{
  if(!recognitionWanted||!running)return;
  recognition=new SR();
  recognition.continuous=true;
  recognition.interimResults=false;
  recognition.lang="en-US";
  recognition.onstart=()=>{
   recognizing=true;
   micBtn.textContent="MIC LISTENING";
   setStatus("Listening — speak naturally. Your mic is used for transcription only.");
  };
  recognition.onerror=e=>{
   recognizing=false;
   if(e.error==="not-allowed"||e.error==="service-not-allowed"){
    recognitionWanted=false;
    micBtn.textContent="START MIC";
    setStatus("Microphone permission was denied. Allow microphone access for this page and press START MIC again.");
   }else if(e.error!=="aborted"){
    setStatus("Speech recognition: "+e.error+" — reconnecting…");
   }
  };
  recognition.onend=()=>{
   recognizing=false;
   if(recognitionWanted&&running){
    micBtn.textContent="MIC RECONNECTING";
    setTimeout(launch,250);
   }else{
    micBtn.textContent="START MIC";
   }
  };
  recognition.onresult=e=>{
   for(let i=e.resultIndex;i<e.results.length;i++){
    if(!e.results[i].isFinal)continue;
    const phrase=e.results[i][0]?.transcript?.trim();
    if(!phrase||!running)continue;
    text.value=phrase;
    void speak(phrase);
   }
  };
  try{recognition.start();}
  catch(e){if(recognitionWanted)setTimeout(launch,500);}
 };
 launch();
}

async function startTTS(){
 try{
  start.disabled=true;
  micBtn.disabled=true;
  await initTTS();
  await prepareVoice();
  if(!player)throw new Error("Audio player is missing.");
  await setOutput();
  running=true;
  stop.disabled=false;
  micBtn.disabled=false;
  setStatus("PocketTTS ready — press START MIC and speak.");
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
 speechQueue=[];
 speaking=false;
 stopRecognition();
 if(tts){try{tts.stop();}catch{}}
 if(player){
  player.pause();
  player.currentTime=0;
  if(player._blobUrl){URL.revokeObjectURL(player._blobUrl);player._blobUrl=null;}
  player.removeAttribute("src");
  player.load();
 }
 stop.disabled=true;
 start.disabled=false;
 micBtn.disabled=false;
 setStatus("Stopped. No raw microphone audio is played.");
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
