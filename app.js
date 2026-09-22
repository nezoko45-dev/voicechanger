import { createRVC, runPipelineInWorker } from "https://cdn.jsdelivr.net/npm/rvc-web-runtime@1.0.5/+esm";

const $=id=>document.getElementById(id);
const status=$("status");
let rvc=null, files=null, audioCtx=null, mediaStream=null, worklet=null, running=false;
let queue=[], processing=false, playAt=0;

function say(text,kind=""){status.textContent=text;status.className="status "+kind}
function needFiles(){
 const model=$("model").files[0], content=$("content").files[0], rmvpe=$("rmvpe").files[0];
 if(!model||!content||!rmvpe) throw Error("Select the RVC .onnx, ContentVec .onnx, and RMVPE .onnx files.");
 return {model,contentVec:content,rmvpe};
}
async function loadVoice(){
 try{
  $("load").disabled=true;
  files=needFiles();
  if(!("gpu" in navigator)) throw Error("This Chrome build does not expose WebGPU.");
  rvc=createRVC();
  say("Voice model ready. Starting the local browser runtime...");
  const gpu=await navigator.gpu.requestAdapter();
  if(!gpu) throw Error("No WebGPU adapter was found. Enable hardware acceleration in Chrome.");
  say("WebGPU detected. Voice model loaded. Press Start continuous mic.","ok");
  $("start").disabled=false;
 }catch(e){
  files=null;$("start").disabled=true;say("Load error: "+e.message,"err");
 }finally{$("load").disabled=false}
}

function makeWorklet(){
 const code=`
 class MicChunker extends AudioWorkletProcessor{
   constructor(){super();this.buf=[];this.n=0;this.target=sampleRate*2.5}
   process(inputs){
     const ch=inputs[0]?.[0]; if(!ch)return true;
     for(let i=0;i<ch.length;i++){this.buf.push(ch[i]);this.n++}
     while(this.n>=this.target){
       const out=new Float32Array(Math.floor(this.target));
       for(let i=0;i<out.length;i++)out[i]=this.buf[i];
       this.buf=this.buf.slice(out.length);this.n-=out.length;
       this.port.postMessage(out,[out.buffer]);
     }
     return true;
   }
 }
 registerProcessor("mic-chunker",MicChunker);`;
 const blob=new Blob([code],{type:"application/javascript"});
 return URL.createObjectURL(blob);
}

async function start(){
 if(!files)return say("Load the voice model first.","err");
 try{
  $("start").disabled=true;$("stop").disabled=false;running=true;queue=[];processing=false;playAt=0;
  audioCtx=new AudioContext({latencyHint:"interactive"});
  await audioCtx.resume();
  mediaStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  const src=audioCtx.createMediaStreamSource(mediaStream);
  const url=makeWorklet();
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  worklet=new AudioWorkletNode(audioCtx,"mic-chunker",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
  const mute=audioCtx.createGain();mute.gain.value=0;
  src.connect(worklet);worklet.connect(mute);mute.connect(audioCtx.destination);
  worklet.port.onmessage=e=>{
   if(!running)return;
   queue.push(e.data);
   if(queue.length>3)queue.shift();
   processQueue();
  };
  say("Continuous microphone is ON. Capturing 2.5-second chunks...","ok");
 }catch(e){stop();say("Start error: "+e.message,"err")}
}

async function processQueue(){
 if(processing||!running||!queue.length)return;
 processing=true;
 const audio=queue.shift();
 try{
  say("Converting live mic chunk locally...");
  const result=await runPipelineInWorker(
   rvc,files,audio,audioCtx.sampleRate,
   {onEvent:e=>{if(e.type==="stage")say("WebGPU/RVC: "+e.stage);}},
   {
    contentVecBackend:"webgpu",
    rmvpeBackend:"webgpu",
    rvcBackend:"wasm",
    pitchShift:Number($("pitch").value),
    medianFilter:true,
    chunkDuration:2.5,
    padDuration:.35,
    inputSampleRate:16000,
    outputSampleRate:48000,
    timeout:120000
   }
  );
  if(result.state!=="success"||!result.outputWav)throw Error(result.errorMessage||"RVC conversion failed.");
  await playWav(result.outputWav);
  say("Voice converted. Mic remains continuous.","ok");
 }catch(e){say("Conversion error: "+e.message,"err")}
 finally{processing=false;if(running)processQueue()}
}

async function playWav(blob){
 const buf=await blob.arrayBuffer();
 const decoded=await audioCtx.decodeAudioData(buf.slice(0));
 const src=audioCtx.createBufferSource();src.buffer=decoded;src.connect(audioCtx.destination);
 const now=audioCtx.currentTime;
 if(playAt<now)playAt=now+.03;
 src.start(playAt);playAt+=decoded.duration;
}

function stop(){
 running=false;queue=[];
 try{worklet?.disconnect()}catch{}
 try{mediaStream?.getTracks().forEach(t=>t.stop())}catch{}
 worklet=null;mediaStream=null;processing=false;
 $("stop").disabled=true;$("start").disabled=!files;
 say(files?"Stopped. Voice model remains loaded.":"Load an RVC voice model first.");
}

$("load").onclick=loadVoice;$("start").onclick=start;$("stop").onclick=stop;
addEventListener("beforeunload",stop);