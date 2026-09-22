const $=id=>document.getElementById(id);
const mic=$("mic"),out=$("out"),voice=$("voice"),key=$("key"),load=$("load"),start=$("start"),stop=$("stop"),cable=$("cable"),refresh=$("refresh"),status=$("status"),msg=$("msg"),transcript=$("transcript");
const RATE=48000,CHUNK=960;
let voiceLoaded=false,running=false,localWs=null,deepgramWs=null,stream=null,ctx=null,source=null,worklet=null,voicemeeterId=null;
const say=t=>msg.textContent=t;
const setStatus=t=>status.innerHTML='<span class="dot"></span>'+t;

async function devices(){
 try{
  const p=await navigator.mediaDevices.getUserMedia({audio:true,video:false});p.getTracks().forEach(t=>t.stop());
  const all=await navigator.mediaDevices.enumerateDevices();
  mic.innerHTML="";out.innerHTML="";
  all.filter(d=>d.kind==="audioinput").forEach(d=>{const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||"Microphone";mic.appendChild(o)});

  const backend=await fetch("/devices",{cache:"no-store"}).then(r=>r.json());
  if(!backend.ok)throw Error(backend.error||"Could not read Windows audio devices.");
  backend.devices.filter(d=>d.output===true).forEach(d=>{const o=document.createElement("option");o.value=String(d.id);o.textContent=d.name;out.appendChild(o)});

  voicemeeterId=backend.voicemeeterId??null;
  if(voicemeeterId!==null)out.value=String(voicemeeterId);
  cable.textContent=voicemeeterId!==null?"Voicemeeter detected":"Voicemeeter not detected";
  say(voicemeeterId!==null?"Voicemeeter output selected.":"Select a Windows playback output.");
 }catch(e){say("Device setup failed: "+e.message)}
}

async function loadVoice(){
 const file=voice.files[0];if(!file)return say("Choose a reference WAV first.");
 load.disabled=true;say("Loading OpenVoice reference...");
 try{
  const b=new Uint8Array(await file.arrayBuffer());let s="";
  for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));
  const r=await fetch("/target",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wav:btoa(s)})});
  const j=await r.json();if(!j.ok)throw Error(j.error||"Voice load failed.");
  voiceLoaded=true;say("OpenVoice reference loaded.");
 }catch(e){say("Voice load failed: "+e.message)}finally{load.disabled=false}
}

async function makeWorklet(){
 const code=[
  "class CaptureProcessor extends AudioWorkletProcessor{",
  "constructor(){super();this.buf=new Float32Array(960);this.used=0}",
  "process(inputs){const input=inputs[0]&&inputs[0][0];if(!input)return true;let p=0;",
  "while(p<input.length){const n=Math.min(input.length-p,this.buf.length-this.used);this.buf.set(input.subarray(p,p+n),this.used);this.used+=n;p+=n;",
  "if(this.used===this.buf.length){this.port.postMessage(this.buf.slice(0));this.used=0}}return true}",
  "}registerProcessor('voicechanger-capture',CaptureProcessor);"
 ].join("\n");
 const url=URL.createObjectURL(new Blob([code],{type:"application/javascript"}));
 await ctx.audioWorklet.addModule(url);URL.revokeObjectURL(url);
}

function pcm16(samples){
 const b=new ArrayBuffer(samples.length*2),v=new DataView(b);
 for(let i=0;i<samples.length;i++){const x=Math.max(-1,Math.min(1,samples[i]));v.setInt16(i*2,x<0?x*32768:x*32767,true)}
 return b;
}

async function connectDeepgram(){
 const apiKey=key.value.trim();if(!apiKey)throw Error("Enter your Deepgram API key.");
 const q=new URLSearchParams({model:"nova-3",language:"en-US",encoding:"linear16",sample_rate:String(RATE),channels:"1",interim_results:"true",punctuate:"true",smart_format:"true",endpointing:"300",vad_events:"true"});
 deepgramWs=new WebSocket("wss://api.deepgram.com/v1/listen?"+q.toString(),["token",apiKey]);
 deepgramWs.binaryType="arraybuffer";
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error("Deepgram connection timed out.")),8000);
  deepgramWs.onopen=()=>{clearTimeout(timer);resolve()};
  deepgramWs.onerror=()=>{clearTimeout(timer);reject(Error("Deepgram WebSocket connection failed."))};
 });
 deepgramWs.onmessage=e=>{
  if(typeof e.data!=="string")return;
  try{const d=JSON.parse(e.data),t=d.channel?.alternatives?.[0]?.transcript||"";if(t)transcript.textContent=(d.is_final?"Final: ":"Live: ")+t}catch{}
 };
 deepgramWs.onclose=()=>{if(running)say("Deepgram disconnected.")};
}

async function connectLocal(){
 localWs=new WebSocket("ws://127.0.0.1:8765/audio");localWs.binaryType="arraybuffer";
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error("Local audio WebSocket timed out.")),5000);
  localWs.onopen=()=>{clearTimeout(timer);resolve()};
  localWs.onerror=()=>{clearTimeout(timer);reject(Error("VoiceChanger audio WebSocket failed."))};
 });
}

async function startCapture(){
 const p=await navigator.mediaDevices.getUserMedia({audio:true,video:false});p.getTracks().forEach(t=>t.stop());
 stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:mic.value?{exact:mic.value}:undefined,channelCount:{ideal:1,max:1},sampleRate:{ideal:RATE},sampleSize:{ideal:16},echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
 ctx=new AudioContext({sampleRate:RATE,latencyHint:"interactive"});await ctx.resume();await makeWorklet();
 source=ctx.createMediaStreamSource(stream);
 worklet=new AudioWorkletNode(ctx,"voicechanger-capture",{numberOfInputs:1,numberOfOutputs:0});
 worklet.port.onmessage=e=>{
  if(!running)return;const b=pcm16(e.data);
  if(localWs?.readyState===WebSocket.OPEN)localWs.send(b);
  if(deepgramWs?.readyState===WebSocket.OPEN)deepgramWs.send(b);
 };
 source.connect(worklet);
}

async function stopCapture(){
 try{worklet?.disconnect()}catch{}try{source?.disconnect()}catch{}try{await ctx?.close()}catch{}
 stream?.getTracks().forEach(t=>t.stop());worklet=source=ctx=stream=null;
}

async function startAudio(){
 if(running)return;
 try{
  if(!voiceLoaded)return say("Load your reference WAV first.");
  if(!mic.value)return say("Select your microphone.");
  start.disabled=true;stop.disabled=true;say("Starting Electron mic → Deepgram + OpenVoice/ONNX...");
  const r=await fetch("/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({external:true,outputId:Number(out.value)})});
  const j=await r.json();if(!j.ok)throw Error(j.error||"Audio engine failed.");
  await connectLocal();await connectDeepgram();running=true;await startCapture();
  stop.disabled=false;setStatus("Running • Mic → Deepgram STT + OpenVoice/ONNX → Voicemeeter");say("Live pipeline running. Converted audio is sent to Voicemeeter.");
 }catch(e){
  running=false;await stopCapture();try{localWs?.close()}catch{}try{deepgramWs?.close()}catch{}try{await fetch("/stop",{method:"POST"})}catch{}
  localWs=deepgramWs=null;start.disabled=false;stop.disabled=true;say("Start failed: "+e.message);setStatus("Stopped");
 }
}

async function stopAudio(){
 running=false;await stopCapture();
 try{if(deepgramWs?.readyState===WebSocket.OPEN)deepgramWs.send(JSON.stringify({type:"Finalize"}))}catch{}
 try{localWs?.close()}catch{}try{deepgramWs?.close()}catch{}try{await fetch("/stop",{method:"POST"})}catch{}
 localWs=deepgramWs=null;start.disabled=false;stop.disabled=true;transcript.textContent="Transcript will appear here.";say("Stopped.");setStatus("Ready");
}
cable.onclick=()=>{if(voicemeeterId){out.value=voicemeeterId;say("Voicemeeter output selected.")}else say("Voicemeeter was not detected.")};
refresh.onclick=devices;load.onclick=loadVoice;start.onclick=startAudio;stop.onclick=stopAudio;
(async()=>{setStatus("Ready");await devices()})();