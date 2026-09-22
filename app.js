const $=id=>document.getElementById(id);
const mic=$("mic"),out=$("out"),voice=$("voice"),load=$("load"),start=$("start"),stop=$("stop");
const cable=$("cable"),refresh=$("refresh"),status=$("status"),msg=$("msg"),deepgramKey=$("deepgramKey");
let ws=null,sourceWs=null,running=false,cableId=null;
let backendReadyResolve=null,backendReadyReject=null;
let stream=null,ctx=null,source=null,worklet=null,capturing=false;
const RATE=48000,CHUNK=960;
const say=x=>msg.textContent=x;
const setStatus=x=>status.innerHTML='<span class="dot"></span>'+x;

function addDevice(select,d,labelExtra=""){
  const o=document.createElement("option");o.value=d.id;o.dataset.name=d.name||"";
  o.textContent=(d.name||"Audio device")+labelExtra;select.appendChild(o);
}
async function health(){
  try{const j=await fetch("/health").then(r=>r.json());
    setStatus(j.voice?"Backend online • Voice loaded":j.models?"Backend online • Models ready":"Backend online • Load a voice");return j;
  }catch{setStatus("Backend offline");return null}
}
async function devices(){
  try{
    const j=await fetch("/devices").then(r=>r.json());if(!j.ok)throw Error(j.error);
    const keepMic=mic.value,keepOut=out.value;mic.innerHTML="";out.innerHTML="";cableId=null;
    for(const d of j.devices){
      const name=String(d.name||""),lower=name.toLowerCase(),isCable=lower.includes("cable input")&&lower.includes("vb-audio");
      let label=name||"Audio device";
      if(d.inputChannels>0)label+=" [input "+d.inputChannels+"]";
      if(d.outputChannels>0)label+=" [output "+d.outputChannels+"]";
      if(isCable){label+=" • VB-CABLE";cableId=String(d.id)}
      if(d.inputChannels>0)addDevice(mic,d,label.replace(/ \[output \d+\]/,""));
      if(d.outputChannels>0)addDevice(out,d,label);
    }
    if([...mic.options].some(x=>x.value===keepMic))mic.value=keepMic;
    if([...out.options].some(x=>x.value===keepOut))out.value=keepOut;
    if(cableId!==null)out.value=cableId;
    cable.disabled=cableId===null;
    cable.textContent=cableId===null?"VB-CABLE not detected":"Use VB-CABLE";
    say(cableId===null?"WASAPI ready.":"VB-CABLE detected. Select it as the output for VRChat/Discord routing.");
  }catch(e){say("Audio device error: "+e.message)}
}
async function requestMicPermission(){
  const s=await navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:1,max:1},sampleRate:{ideal:RATE},sampleSize:{ideal:16},echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
  s.getTracks().forEach(t=>t.stop());
}
function chooseElectronDevice(list,name){
  const target=String(name||"").trim().toLowerCase(),inputs=list.filter(d=>d.kind==="audioinput");
  return inputs.find(d=>d.label===name)||inputs.find(d=>d.label.toLowerCase()===target)||inputs.find(d=>target&&d.label.toLowerCase().includes(target))||inputs[0];
}
async function makeWorklet(){
  const code=[
    "class CaptureProcessor extends AudioWorkletProcessor{",
    "constructor(){super();this.buf=new Float32Array("+CHUNK+");this.used=0}",
    "process(inputs){const input=inputs[0]&&inputs[0][0];if(!input)return true;let p=0;",
    "while(p<input.length){const n=Math.min(input.length-p,this.buf.length-this.used);this.buf.set(input.subarray(p,p+n),this.used);this.used+=n;p+=n;",
    "if(this.used===this.buf.length){const out=this.buf.slice();this.port.postMessage(out,[out.buffer]);this.used=0}}return true}",
    "}registerProcessor('voicechanger-capture',CaptureProcessor);"
  ].join("\n");
  const url=URL.createObjectURL(new Blob([code],{type:"application/javascript"}));
  await ctx.audioWorklet.addModule(url);URL.revokeObjectURL(url);
}
function floatToPcm16(x){
  const b=new ArrayBuffer(x.length*2),v=new DataView(b);
  for(let i=0;i<x.length;i++){const n=Math.max(-1,Math.min(1,x[i]));v.setInt16(i*2,n<0?n*32768:n*32767,true)}
  return b;
}
async function stopCapture(){
  capturing=false;
  try{worklet?.disconnect()}catch{}
  try{source?.disconnect()}catch{}
  try{await ctx?.close()}catch{}
  stream?.getTracks().forEach(t=>t.stop());
  worklet=null;source=null;ctx=null;stream=null;
}
async function startCapture(deviceName){
  await stopCapture();
  await requestMicPermission();
  const list=await navigator.mediaDevices.enumerateDevices(),chosen=chooseElectronDevice(list,deviceName);
  if(!chosen)throw Error("No microphone was found by Electron.");
  stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:chosen.deviceId},channelCount:{ideal:1,max:1},sampleRate:{ideal:RATE},sampleSize:{ideal:16},echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
  ctx=new AudioContext({sampleRate:RATE,latencyHint:"interactive"});
  await ctx.resume();await makeWorklet();
  source=ctx.createMediaStreamSource(stream);
  worklet=new AudioWorkletNode(ctx,"voicechanger-capture",{numberOfInputs:1,numberOfOutputs:0});
  worklet.port.onmessage=e=>{
    if(capturing&&sourceWs?.readyState===WebSocket.OPEN)sourceWs.send(floatToPcm16(new Float32Array(e.data)));
  };
  source.connect(worklet);capturing=true;
  setStatus("Electron microphone active • "+(chosen.label||deviceName||"default"));
}
async function connectSource(){
  let lastError=null;
  for(let attempt=1;attempt<=15;attempt++){
    try{
      if(sourceWs){try{sourceWs.close()}catch{}}
      await new Promise((resolve,reject)=>{
        const s=new WebSocket("ws://127.0.0.1:8765/source");
        sourceWs=s;s.binaryType="arraybuffer";
        let settled=false;
        s.onopen=()=>{settled=true;resolve()};
        s.onerror=()=>{if(!settled){settled=true;reject(Error("Electron audio connection failed."))}};
        s.onclose=()=>{if(!settled){settled=true;reject(Error("Electron audio connection closed."));}if(running){void stopCapture();say("Electron audio disconnected.")}};
      });
      return;
    }catch(e){
      lastError=e;
      await new Promise(r=>setTimeout(r,400));
    }
  }
  throw lastError||Error("Electron audio connection failed.");
}
function connectBackend(){
  return new Promise((resolve,reject)=>{
    ws=new WebSocket("ws://127.0.0.1:8765/audio");
    ws.onopen=resolve;
    ws.onerror=()=>reject(Error("Backend connection failed."));
    ws.onmessage=e=>{
      try{
        const m=JSON.parse(e.data);
        if(m.type==="status"){
          say(m.text);
          if(m.text.includes("Deepgram STT connected")){
            backendReadyResolve?.();backendReadyResolve=null;backendReadyReject=null;
          }
        }
        if(m.type==="error"){
          say("Backend: "+m.error);
          backendReadyReject?.(Error(m.error));backendReadyResolve=null;backendReadyReject=null;
        }
      }catch{}
    };
    ws.onclose=()=>{
      backendReadyReject?.(Error("Backend connection closed."));
      backendReadyResolve=null;backendReadyReject=null;
      running=false;start.disabled=false;stop.disabled=true;void stopCapture();
    };
  });
}
function waitForBackendReady(){
  return new Promise((resolve,reject)=>{
    backendReadyResolve=resolve;backendReadyReject=reject;
  });
}
load.onclick=async()=>{
  const f=voice.files[0];
  if(!f){say("Choose a WAV first.");return}
  load.disabled=true;say("Loading reference voice...");
  try{
    const b=new Uint8Array(await f.arrayBuffer());let s="";
    for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));
    const r=await fetch("/target",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wav:btoa(s)})});
    const j=await r.json();if(!j.ok)throw Error(j.error);
    say("Reference voice loaded.");await health();
  }catch(e){say("Voice load failed: "+e.message)}
  finally{load.disabled=false}
};
start.onclick=async()=>{
  if(running)return;
  try{
    const h=await health();
    if(!h?.voice){say("Load a reference WAV first.");return}
    if(!deepgramKey.value.trim()){say("Enter your Deepgram API key first.");deepgramKey.focus();return}
    if(!mic.value){say("Choose a microphone.");return}
    if(!out.value){say("Choose an output device.");return}
    if(!sourceWs||sourceWs.readyState!==WebSocket.OPEN)await connectSource();
    if(!ws||ws.readyState!==WebSocket.OPEN)await connectBackend();
    running=true;start.disabled=true;stop.disabled=true;
    const ready=waitForBackendReady();
    ws.send(JSON.stringify({type:"start",inputName:mic.options[mic.selectedIndex]?.dataset.name||"",outputId:out.value,deepgramKey:deepgramKey.value.trim()}));
    await ready;
    await startCapture(mic.options[mic.selectedIndex]?.dataset.name||"");
    stop.disabled=false;
    say("Deepgram is listening • speak normally");
  }catch(e){
    running=false;start.disabled=false;stop.disabled=true;
    say("Start failed: "+e.message);
    try{ws?.close()}catch{}try{sourceWs?.close()}catch{}
  }
};
stop.onclick=async()=>{
  try{ws?.send(JSON.stringify({type:"stop"}))}catch{}
  await stopCapture();
  try{sourceWs?.close()}catch{}try{ws?.close()}catch{}
  running=false;start.disabled=false;stop.disabled=true;say("Stopped.");
};
cable.onclick=()=>{
  if(cableId===null){say("VB-CABLE was not detected. Install it, then Refresh devices.");return}
  out.value=cableId;say("VB-CABLE selected as the WASAPI output.");
};
refresh.onclick=async()=>{await health();await devices()};
(async()=>{
  deepgramKey.value=localStorage.getItem("deepgramKey")||"";
  deepgramKey.addEventListener("input",()=>localStorage.setItem("deepgramKey",deepgramKey.value));
  await health();await devices();
  try{await connectSource()}catch{say("Electron audio is waiting for the backend...")}
})();