const $=id=>document.getElementById(id);
const key=$("key"),reference=$("reference"),output=$("output"),chooseOutput=$("chooseOutput"),text=$("text"),start=$("start"),stop=$("stop"),status=$("status"),info=$("info");

const AGENT_URL="wss://agent.deepgram.com/v1/agent/converse";
const TTS_URL="./pocket-tts/index.js";
const TARGET_RATE=16000;

let socket=null,micStream=null,micContext=null,micSource=null,processor=null,muteGain=null;
let tts=null,voiceRef=null,ttsPlayer=null,running=false,ttsBusy=false,ttsQueue=[];
let reconnectTimer=null,reconnectDelay=500,reconnectGeneration=0,keepAliveTimer=null;

function setStatus(v){status.textContent=v;}
function updateStartButton(){start.disabled=!(key.value.trim()&&reference.files?.[0]&&!running);}
async function setOutput(){
 if(ttsPlayer?.setSinkId){
  try{await ttsPlayer.setSinkId(output.value||"");}catch(e){console.warn(e);}
 }
}
async function loadOutputs(){
 if(!navigator.mediaDevices?.enumerateDevices)return;
 try{
  const devices=await navigator.mediaDevices.enumerateDevices();
  const old=output.value;
  output.innerHTML="<option value=''>Default Windows output</option>";
  for(const d of devices.filter(x=>x.kind==="audiooutput")){
   const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||"Speaker / output "+output.options.length;output.appendChild(o);
  }
  if([...output.options].some(x=>x.value===old))output.value=old;
 }catch(e){}
}
async function chooseChromeSpeaker(){
 if(!navigator.mediaDevices?.selectAudioOutput){setStatus("Chrome speaker picker unavailable; using the default output.");return;}
 try{
  const d=await navigator.mediaDevices.selectAudioOutput();
  if(d?.deviceId){output.innerHTML="";const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||"Selected Chrome speaker";output.appendChild(o);await setOutput();setStatus("Speaker selected.");}
 }catch(e){if(e.name!=="NotAllowedError")setStatus("Speaker picker error: "+e.message);}
}
async function initTTS(){
 if(tts)return;
 const mod=await import(TTS_URL);
 tts=new mod.PocketTTS({language:"english_2026-04",quantized:true,voiceCloning:true,cache:true,maxThreads:8,maxReferenceSeconds:6});
 ttsPlayer=new mod.StreamingPlayer({sampleRate:tts.sampleRate});
 await ttsPlayer.resume();
 setStatus("Loading PocketTTS models…");
 await tts.load(p=>{if(p?.label)setStatus("PocketTTS: "+p.label);else if(p?.status)setStatus("PocketTTS: "+p.status);});
 await setOutput();
}
async function prepareVoice(){
 const file=reference.files?.[0];if(!file)throw new Error("Choose a WAV voice reference first.");
 const buf=await file.arrayBuffer(),ac=new AudioContext();
 try{
  const decoded=await ac.decodeAudioData(buf);
  setStatus("Cloning your WAV voice…");
  voiceRef=await tts.cloneVoice(decoded.getChannelData(0).slice(),{inputSampleRate:decoded.sampleRate,name:"pockettts-agent-clone"});
 }finally{await ac.close();}
 await tts.finishLoad();
 info.textContent="Deepgram Agent → PocketTTS clone → Chrome speaker.";
}
async function speak(textValue){
 const phrase=textValue.trim();if(!running||!phrase)return;
 ttsQueue.push(phrase);if(ttsBusy)return;
 ttsBusy=true;
 try{
  while(running&&ttsQueue.length){
   const current=ttsQueue.shift();
   setStatus("PocketTTS speaking: "+current);
   await tts.generate(current,{voice:voiceRef,onChunk:(audio,meta)=>{if(running)ttsPlayer.play(audio,meta);}});
   if(running)ttsPlayer.flush();
  }
 }catch(e){console.error(e);if(running)setStatus("PocketTTS error: "+(e.message||e));}
 finally{ttsBusy=false;if(running)setStatus("Deepgram listening — speak naturally.");}
}
function downsampleFloat32To16(input,srcRate){
 if(srcRate===TARGET_RATE){
  const out=new Int16Array(input.length);
  for(let i=0;i<input.length;i++){const s=Math.max(-1,Math.min(1,input[i]));out[i]=s<0?s*32768:s*32767;}return out;
 }
 const ratio=srcRate/TARGET_RATE,outLen=Math.max(1,Math.round(input.length/ratio)),out=new Int16Array(outLen);
 for(let i=0;i<outLen;i++){const pos=i*ratio,idx=Math.floor(pos),frac=pos-idx;const a=input[Math.min(idx,input.length-1)],b=input[Math.min(idx+1,input.length-1)];const s=a+(b-a)*frac;out[i]=Math.max(-32768,Math.min(32767,s<0?s*32768:s*32767));}
 return out;
}
function sendMic(){
 if(!socket||socket.readyState!==WebSocket.OPEN||!processor)return;
}
async function startMic(){
 micStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
 micContext=new AudioContext();
 await micContext.resume();
 micSource=micContext.createMediaStreamSource(micStream);
 processor=micContext.createScriptProcessor(4096,1,1);
 muteGain=micContext.createGain();
 muteGain.gain.value=0;
 processor.onaudioprocess=e=>{
  if(!running||!socket||socket.readyState!==WebSocket.OPEN)return;
  const pcm=downsampleFloat32To16(e.inputBuffer.getChannelData(0),micContext.sampleRate);
  socket.send(pcm.buffer);
 };
 micSource.connect(processor);
 processor.connect(muteGain);
 muteGain.connect(micContext.destination);
}
function stopMic(){
 try{processor?.disconnect();}catch{}try{muteGain?.disconnect();}catch{}try{micSource?.disconnect();}catch{}
 processor=null;muteGain=null;micSource=null;
 micStream?.getTracks().forEach(t=>t.stop());micStream=null;
 if(micContext){try{micContext.close();}catch{}micContext=null;}
}
function cancelReconnect(){if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}}
function startKeepAlive(){
 clearInterval(keepAliveTimer);
 keepAliveTimer=setInterval(()=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:"KeepAlive"}));},8000);
}
function stopKeepAlive(){clearInterval(keepAliveTimer);keepAliveTimer=null;}
function scheduleReconnect(reason="connection lost"){
 if(!running||reconnectTimer)return;
 const gen=++reconnectGeneration,delay=Math.min(reconnectDelay,5000);
 try{if(socket&&socket.readyState!==WebSocket.CLOSED)socket.close();}catch{}
 setStatus("Deepgram Agent "+reason+" — reconnecting in "+(delay/1000).toFixed(1)+"s…");
 reconnectTimer=setTimeout(()=>{reconnectTimer=null;if(!running||gen!==reconnectGeneration)return;connectAgent();},delay);
 reconnectDelay=Math.min(reconnectDelay*1.5,5000);
}
function connectAgent(){
 if(!running)return;
 try{socket?.close();}catch{}
 const ws=new WebSocket(AGENT_URL,["token",key.value.trim()]);
 socket=ws;
 ws.binaryType="arraybuffer";
 ws.onopen=()=>setStatus("Deepgram Agent connected — waiting for configuration…");
 ws.onmessage=async e=>{
  if(typeof e.data!=="string")return;
  let m;try{m=JSON.parse(e.data);}catch{return;}
  if(m.type==="Welcome"){
   ws.send(JSON.stringify({
    type:"Settings",
    audio:{input:{encoding:"linear16",sample_rate:TARGET_RATE},output:{encoding:"linear16",sample_rate:24000,container:"none"}},
    agent:{
     listen:{provider:{type:"deepgram",version:"v2",model:"flux-general-en"}},
     think:{provider:{type:"open_ai",model:"gpt-4o-mini"},prompt:"Repeat the user's words exactly. Do not answer, explain, greet, help, or add anything. Your response must contain only the user's exact words, preserving their wording as closely as possible."},
     speak:{provider:{type:"deepgram",version:"v2",model:"flux-kit-en"}},
     greeting:""
    }
   }));
  }else if(m.type==="SettingsApplied"){
   reconnectDelay=500;
   setStatus("Deepgram listening — speak naturally.");
  }else if(m.type==="ConversationText"){
   if(m.role==="user"){
    text.value=(text.value+" "+m.content).trim();
   }else if(m.role==="assistant"){
    void speak(m.content);
   }
  }else if(m.type==="UserStartedSpeaking"){
   // Keep PocketTTS streaming unless a new turn arrives; no raw mic playback.
  }else if(m.type==="Error"||m.type==="Warning"){
   console.warn("Deepgram Agent",m);
   const desc=m.description||m.message||"unknown";
   if(m.type==="Error"){
    setStatus("Deepgram error: "+desc+" — reconnecting…");
    scheduleReconnect(m.code||"error");
   }else{
    setStatus("Deepgram warning: "+desc);
    if(m.code==="MAXIMUM_SESSION_LENGTH_APPROACHING"){
     setStatus("Deepgram session ending soon — preparing a fresh connection…");
     scheduleReconnect("session rollover");
    }
   }
  }
 };
 ws.onerror=()=>{if(running)setStatus("Deepgram Agent connection error — reconnecting…");};
 ws.onclose=(ev)=>{if(running)scheduleReconnect(ev?.reason||"disconnected");};
 startKeepAlive();
 // Deepgram can close an idle Agent, but normal mic streaming should prevent that.
 // Restart the session if the browser/network drops the WebSocket.
}
async function startAll(){
 if(running)return;
 try{
  if(!key.value.trim())throw new Error("Enter your Deepgram API key.");
  if(!reference.files?.[0])throw new Error("Choose your WAV voice reference first.");
  start.disabled=true;setStatus("Starting Deepgram Agent + PocketTTS…");
  await initTTS();await prepareVoice();await loadOutputs();await setOutput();
  await startMic();
  running=true;stop.disabled=false;reconnectDelay=500;reconnectGeneration++;cancelReconnect();connectAgent();
 }catch(e){
  console.error(e);running=false;stop.disabled=true;stopMic();cancelReconnect();stopKeepAlive();
  try{socket?.close();}catch{}socket=null;
  if(ttsPlayer){try{await ttsPlayer.destroy();}catch{}ttsPlayer=null;}
  setStatus("Start error: "+(e.message||e));updateStartButton();
 }
}
async function stopAll(){
 running=false;reconnectGeneration++;cancelReconnect();stopKeepAlive();ttsQueue=[];
 try{socket?.close();}catch{}socket=null;stopMic();
 if(tts){try{await tts.stop();}catch{}}
 if(ttsPlayer){try{await ttsPlayer.destroy();}catch{}ttsPlayer=null;}
 stop.disabled=true;updateStartButton();setStatus("Stopped. Raw microphone audio is never played.");
}
key.oninput=updateStartButton;reference.onchange=updateStartButton;start.onclick=()=>void startAll();stop.onclick=()=>void stopAll();chooseOutput.onclick=chooseChromeSpeaker;output.onchange=()=>void setOutput();navigator.mediaDevices?.addEventListener?.("devicechange",loadOutputs);void loadOutputs();updateStartButton();