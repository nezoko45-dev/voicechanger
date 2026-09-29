const $=id=>document.getElementById(id);
const model=$("model"),mic=$("mic"),output=$("output"),chooseOutput=$("chooseOutput"),start=$("start"),micBtn=$("micBtn"),stop=$("stop"),player=$("player"),status=$("status"),diagnostic=$("diagnostic");
let ort=null,session=null,running=false,stream=null,ctx=null,processor=null,silentGain=null;

const setStatus=v=>status.textContent=v;
function setDiag(v){diagnostic.textContent=v;}

async function checkGPU(){
 if(!navigator.gpu)throw new Error("Chrome WebGPU is unavailable. Open this page in current Chrome/Edge with WebGPU enabled.");
 const adapter=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});
 if(!adapter)throw new Error("Chrome exposed WebGPU, but no compatible GPU adapter was found.");
 const info=adapter.info||{};
 return {adapter,info};
}
async function loadDevices(){
 const ds=await navigator.mediaDevices?.enumerateDevices?.()||[];
 mic.innerHTML="<option value=''>Default microphone</option>";
 output.innerHTML="<option value=''>Default Windows output</option>";
 for(const d of ds){
  const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||("Device "+d.deviceId.slice(0,8));
  if(d.kind==="audioinput")mic.appendChild(o);
  if(d.kind==="audiooutput")output.appendChild(o);
 }
}
async function setSink(){
 if(typeof player.setSinkId==="function"){
  try{await player.setSinkId(output.value||"");}catch(e){console.warn(e);}
 }
}
async function chooseSpeaker(){
 if(!navigator.mediaDevices?.selectAudioOutput){setStatus("Chrome speaker picker is unavailable; using the default output.");return;}
 try{
  const d=await navigator.mediaDevices.selectAudioOutput();
  if(d){output.innerHTML="";const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||"Selected Chrome speaker";output.appendChild(o);await setSink();}
 }catch(e){if(e.name!=="NotAllowedError")setStatus("Speaker picker error: "+e.message);}
}
function pcmToWav(samples,sr){
 const b=new ArrayBuffer(44+samples.length*2),v=new DataView(b),w=(p,s)=>[...s].forEach((c,i)=>v.setUint8(p+i,c.charCodeAt(0)));
 w(0,"RIFF");v.setUint32(4,36+samples.length*2,true);w(8,"WAVE");w(12,"fmt ");
 v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);
 v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,"data");v.setUint32(40,samples.length*2,true);
 let p=44;for(const x of samples){const s=Math.max(-1,Math.min(1,x));v.setInt16(p,s<0?s*32768:s*32767,true);p+=2;}return new Blob([b],{type:"audio/wav"});
}
async function play(samples,sr){
 await setSink();const u=URL.createObjectURL(pcmToWav(samples,sr));player.src=u;player.load();
 try{await player.play();}catch{setStatus("Chrome blocked autoplay. Press Play on the converted audio player.");}
 player.onended=()=>URL.revokeObjectURL(u);
}
async function init(){
 const {info}=await checkGPU();
 ort=await import("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/webgpu/+esm");
 const file=model.files?.[0];if(!file)throw new Error("Choose an ONNX voice-conversion model first.");
 const bytes=await file.arrayBuffer();
 setStatus("Creating ONNX Runtime WebGPU session…");
 session=await ort.InferenceSession.create(bytes,{
   executionProviders:["webgpu"],
   graphOptimizationLevel:"all"
 });
 const ins=session.inputNames.map(n=>n+" "+JSON.stringify(session.inputMetadata?.[n]||""));
 const outs=session.outputNames.map(n=>n+" "+JSON.stringify(session.outputMetadata?.[n]||""));
 setDiag("GPU: "+(info?.vendor||"unknown")+" "+(info?.architecture||"")+
 "\nExecution provider: WEBGPU ONLY"+
 "\nInputs: "+session.inputNames.join(", ")+
 "\nOutputs: "+session.outputNames.join(", ")+
 "\n\nThis session was created with executionProviders: ['webgpu']. WASM is not registered.");
 if(session.inputNames.length!==1||session.outputNames.length!==1){
   throw new Error("This model exposes "+session.inputNames.length+" inputs and "+session.outputNames.length+" outputs. The generic audio path needs a single audio input/output model; RVC requires its full multi-model pipeline.");
 }
}
async function startMic(){
 if(!running)return;
 stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:mic.value?{exact:mic.value}:undefined},video:false});
 ctx=new AudioContext();
 const source=ctx.createMediaStreamSource(stream);
 processor=ctx.createScriptProcessor(4096,1,1);
 processor.onaudioprocess=async e=>{
  if(!running||!session)return;
  const input=e.inputBuffer.getChannelData(0);
  const inputName=session.inputNames[0];
  try{
   // Generic audio-to-audio contract: [1, samples].
   const tensor=new ort.Tensor("float32",new Float32Array(input),[1,input.length]);
   const result=await session.run({[inputName]:tensor});
   const out=result[session.outputNames[0]];
   if(out?.data){const samples=Float32Array.from(out.data);await play(samples,ctx.sampleRate);}
  }catch(err){setStatus("WebGPU model inference failed: "+err.message);stopAll();}
 };
 source.connect(processor);silentGain=ctx.createGain();silentGain.gain.value=0;processor.connect(silentGain);silentGain.connect(ctx.destination);
 setStatus("WEBGPU MIC ACTIVE — converted audio is sent only to Chrome player.");
}
async function startAll(){
 try{
  start.disabled=true;await init();running=true;stop.disabled=false;micBtn.disabled=false;setStatus("WebGPU ready — press START MIC.");
 }catch(e){
  console.error(e);setStatus("WebGPU setup failed: "+e.message);start.disabled=false;micBtn.disabled=true;
 }
}
function stopAll(){
 running=false;micBtn.disabled=true;stop.disabled=true;start.disabled=false;
 try{processor?.disconnect();}catch{}try{silentGain?.disconnect();}catch{}try{stream?.getTracks().forEach(t=>t.stop());}catch{}try{ctx?.close();}catch{}
 processor=null;silentGain=null;stream=null;ctx=null;if(player){player.pause();player.removeAttribute("src");player.load();}
 setStatus("Stopped. No raw microphone audio is played.");
}
chooseOutput.onclick=chooseSpeaker;start.onclick=()=>void startAll();micBtn.onclick=()=>void startMic();stop.onclick=stopAll;
navigator.mediaDevices?.addEventListener?.("devicechange",loadDevices);void loadDevices();