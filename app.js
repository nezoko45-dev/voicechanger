const $=id=>document.getElementById(id);
const mic=$("mic"),output=$("output"),chooseOutput=$("chooseOutput"),start=$("start"),stop=$("stop"),test=$("test"),status=$("status"),gpu=$("gpu");
const modelInput=$("model");
const pitch=$("pitch"),chunk=$("chunk"),pitchValue=$("pitchValue"),chunkValue=$("chunkValue");
let rvc=null,mediaStream=null,captureContext=null,sourceNode=null,processorNode=null;
let running=false,processing=false,queue=[],captureBuffer=[],lastOutputAt=0;

const CONTENTVEC_URL="https://huggingface.co/NaruseMioShirakana/MoeSS-SUBModel/resolve/main/vec-768-layer-12.onnx";
const RMVPE_URL="https://huggingface.co/NaruseMioShirakana/MoeSS-SUBModel/resolve/main/RMVPE.onnx";
let autoContentVec=null,autoRMVPE=null,supportModelsReady=false;

function setStatus(v){status.textContent=v;}
function setGpu(v){gpu.textContent=v;}

async function checkWebGPU(){
 if(!navigator.gpu){setStatus("WebGPU is not available in this Chrome session.");setGpu("Use current Chrome/Edge with WebGPU enabled.");return false;}
 try{
  const adapter=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});
  if(!adapter){setStatus("Chrome exposed WebGPU, but no GPU adapter was available.");return false;}
  setStatus("WebGPU ready. Choose your RVC voice model, then press START RVC.");
  setGpu("GPU: "+(adapter.info?.device||adapter.info?.description||"available"));
  return true;
 }catch(e){setStatus("WebGPU check failed: "+(e.message||e));return false;}
}

async function loadModel(url,label){
 try{
  const response=await fetch(url);
  if(!response.ok)throw new Error("HTTP "+response.status);
  const blob=await response.blob();
  return new File([blob],label,{type:"application/octet-stream"});
 }catch(e){
  console.warn("Model download failed",url,e);
  return null;
 }
}

async function ensureSupportModels(){
 if(supportModelsReady&&autoContentVec&&autoRMVPE)return;
 setStatus("Downloading ContentVec…");
 const [contentVec,rmvpe]=await Promise.all([
  autoContentVec||loadModel(CONTENTVEC_URL,"vec-768-layer-12.onnx"),
  autoRMVPE||loadModel(RMVPE_URL,"RMVPE.onnx")
 ]);
 autoContentVec=contentVec;
 autoRMVPE=rmvpe;
 if(!autoContentVec||!autoRMVPE)throw new Error("Automatic support-model download failed. Check your internet connection.");
 supportModelsReady=true;
 setStatus("Support models ready. Choose your RVC voice model.");
}
function selectedFile(input){return input.files?.[0]||null;}

async function chooseWindowsOutput(){
 if(!navigator.mediaDevices?.selectAudioOutput){setStatus("Chrome speaker picker is unavailable here. The default Windows output will be used.");return;}
 try{
  const d=await navigator.mediaDevices.selectAudioOutput();
  if(d?.deviceId){
   output.innerHTML="";
   const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||"Selected Windows output";output.appendChild(o);
   output.value=d.deviceId;
   setStatus("Output selected: "+(d.label||"Windows audio device"));
  }
 }catch(e){if(e?.name!=="NotAllowedError")setStatus("Output picker failed: "+(e.message||e));}
}

function createPlayback(){
 const ctx=new AudioContext({latencyHint:"interactive"});
 return ctx;
}
let playbackContext=null;
async function setOutputDevice(){
 if(!playbackContext||typeof playbackContext.setSinkId!=="function")return;
 try{await playbackContext.setSinkId(output.value||"");}catch(e){console.warn(e);}
}
async function playPCM(samples,sampleRate=48000){
 if(!playbackContext)playbackContext=createPlayback();
 await playbackContext.resume();
 await setOutputDevice();
 const copy=samples.slice();
 const buffer=playbackContext.createBuffer(1,copy.length,sampleRate);
 buffer.copyToChannel(copy,0);
 const node=playbackContext.createBufferSource();
 node.buffer=buffer;
 node.connect(playbackContext.destination);
 const now=playbackContext.currentTime;
 const startAt=Math.max(now,lastOutputAt);
 node.start(startAt);
 lastOutputAt=startAt+buffer.duration;
}

function downsample(input,inputRate,targetRate){
 if(inputRate===targetRate)return input.slice();
 const ratio=inputRate/targetRate;
 const length=Math.max(1,Math.round(input.length/ratio));
 const out=new Float32Array(length);
 for(let i=0;i<length;i++){
  const pos=i*ratio,idx=Math.floor(pos),frac=pos-idx;
  const a=input[idx]||0,b=input[Math.min(idx+1,input.length-1)]||0;
  out[i]=a+(b-a)*frac;
 }
 return out;
}

function captureProcessor(){
 return `class RvcCapture extends AudioWorkletProcessor{
  process(inputs,outputs){
   const input=inputs[0]?.[0],out=outputs[0]?.[0];
   if(out)out.fill(0);
   if(input&&input.length)this.port.postMessage(input.slice(0));
   return true;
  }
}registerProcessor("rvc-capture",RvcCapture);`;
}

async function startCapture(){
 mediaStream=await navigator.mediaDevices.getUserMedia({audio:{
  deviceId:mic.value?{exact:mic.value}:undefined,
  channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true
 }});
 captureContext=new AudioContext({latencyHint:"interactive"});
 await captureContext.resume();
 const url=URL.createObjectURL(new Blob([captureProcessor()],{type:"application/javascript"}));
 try{await captureContext.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
 sourceNode=captureContext.createMediaStreamSource(mediaStream);
 processorNode=new AudioWorkletNode(captureContext,"rvc-capture");
 processorNode.port.onmessage=e=>{
  if(!running)return;
  const part=e.data instanceof Float32Array?e.data:new Float32Array(e.data);
  captureBuffer.push(part);
  const needed=Math.floor(captureContext.sampleRate*Number(chunk.value));
  let total=0;for(const p of captureBuffer)total+=p.length;
  while(total>=needed){
   const joined=new Float32Array(needed);
   let at=0;
   while(at<needed&&captureBuffer.length){
    const p=captureBuffer[0],take=Math.min(p.length,needed-at);
    joined.set(p.subarray(0,take),at);at+=take;
    if(take===p.length)captureBuffer.shift();else captureBuffer[0]=p.subarray(take);
   }
   total-=needed;
   queue.push(joined);
   void processQueue();
  }
 };
 sourceNode.connect(processorNode);
 processorNode.connect(captureContext.destination);
}

async function processQueue(){
 if(processing||!running)return;
 processing=true;
 try{
  while(queue.length&&running){
   const raw=queue.shift();
   const audio16=downsample(raw,captureContext.sampleRate,16000);
   setStatus("RVC converting… queue: "+queue.length);
   const model=selectedFile(modelInput,null);
   const contentVec=selectedFile(contentVecInput,autoContentVec);
   const rmvpe=selectedFile(rmvpeInput,autoRMVPE);
   if(!model)throw new Error("Select your trained RVC .onnx or .pth voice model first.");
   if(!contentVec||!rmvpe)throw new Error("ContentVec and RMVPE models are required.");
   if(!rvc)rvc=await import("https://cdn.jsdelivr.net/npm/rvc-web-runtime@1.0.5/dist/index.js");
   const ctx=rvc.createRVC();
   const result=await rvc.runPipelineInWorker(ctx,{model,contentVec,rmvpe},audio16,16000,
    {onEvent:event=>{
      if(event.type==="stage")setStatus("RVC: "+event.stage);
      else if(event.type==="chunk")setStatus("RVC: chunk "+event.current+"/"+event.total);
    }},
    {timeout:120000,pitchShift:Number(pitch.value)||0,medianFilter:true,medianFilterWindow:3,
     contentVecBackend:"webgpu",rmvpeBackend:"webgpu",rvcBackend:"wasm",chunkDuration:Number(chunk.value),padDuration:.15});
   if(result.state!=="success"||!result.outputAudio)throw new Error(result.errorMessage||"RVC conversion failed.");
   await playPCM(result.outputAudio,48000);
   setStatus(running?"RVC live — listening.":"Stopped.");
  }
 }catch(e){
  console.error(e);queue.length=0;setStatus("RVC error: "+(e.message||e));
 }finally{processing=false;}
}

async function startRVC(){
 if(running)return;
 try{
  start.disabled=true;
  if(!await checkWebGPU())throw new Error("WebGPU is required for the accelerated ContentVec/RMVPE path.");
  const model=selectedFile(modelInput,null);
  if(!model)throw new Error("Choose your trained RVC .onnx or .pth voice model first.");
  setStatus("Preparing browser RVC…");
  await ensureSupportModels();
  await loadDevices();
  if(!playbackContext)playbackContext=createPlayback();
  await setOutputDevice();
  await startCapture();
  captureBuffer=[];queue=[];lastOutputAt=playbackContext.currentTime;
  running=true;stop.disabled=false;test.disabled=true;
  setStatus("RVC live — speak. Conversion is chunked to keep the browser responsive.");
 }catch(e){
  console.error(e);stopRVC();start.disabled=false;setStatus(e.message||String(e));
 }
}

function stopRVC(){
 running=false;
 if(processorNode){try{processorNode.disconnect();}catch{}processorNode=null;}
 if(sourceNode){try{sourceNode.disconnect();}catch{}sourceNode=null;}
 if(captureContext){try{captureContext.close();}catch{}captureContext=null;}
 if(mediaStream){mediaStream.getTracks().forEach(t=>t.stop());mediaStream=null;}
 captureBuffer=[];queue=[];
 if(playbackContext){lastOutputAt=playbackContext.currentTime;}
 start.disabled=false;stop.disabled=true;test.disabled=false;setStatus("Stopped.");
}

async function testChromeAudio(){
 try{
  if(!playbackContext)playbackContext=createPlayback();
  await playbackContext.resume();await setOutputDevice();
  const rate=48000,dur=.6,a=new Float32Array(rate*dur);
  for(let i=0;i<a.length;i++){const t=i/rate;const fade=Math.min(1,i/(rate*.04),(a.length-i)/(rate*.04));a[i]=Math.sin(2*Math.PI*440*t)*.12*Math.max(0,fade);}
  await playPCM(a,rate);setStatus("Chrome audio test played.");
 }catch(e){setStatus("Audio test failed: "+(e.message||e));}
}

pitch.addEventListener("input",()=>pitchValue.textContent=pitch.value);
chunk.addEventListener("input",()=>chunkValue.textContent=Number(chunk.value).toFixed(1));
start.onclick=startRVC;stop.onclick=stopRVC;test.onclick=testChromeAudio;
chooseOutput.onclick=chooseWindowsOutput;
output.addEventListener("change",setOutputDevice);
navigator.mediaDevices?.addEventListener?.("devicechange",loadDevices);
void loadDevices();void checkWebGPU();void ensureSupportModels().catch(e=>setStatus("Support model download failed: "+(e.message||e)));
