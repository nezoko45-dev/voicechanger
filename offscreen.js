// Local-only audio comparison: raw audio is posted only to 127.0.0.1.
let micStream=null,tabStream=null,micContext=null,tabContext=null,queue=Promise.resolve(),stopped=true,lastMismatchAt=0;
const COOLDOWN_MS=15000;
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(message?.type==="FISH_AUDIO_OFFSCREEN_START"){start(message.streamId).then(()=>sendResponse({ok:true}),e=>sendResponse({ok:false,error:String(e?.message||e)}));return true;}
 if(message?.type==="FISH_AUDIO_OFFSCREEN_STOP"){stop();sendResponse({ok:true});}
});
async function start(streamId){
 stop();stopped=false;lastMismatchAt=0;
 micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
 tabStream=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:"tab",chromeMediaSourceId:streamId}},video:false});
 micContext=new AudioContext();tabContext=new AudioContext();
 await Promise.all([micContext.audioWorklet.addModule(chrome.runtime.getURL("audio-worklet.js")),tabContext.audioWorklet.addModule(chrome.runtime.getURL("audio-worklet.js"))]);
 makeSegmenter(micContext,micStream,"user");makeSegmenter(tabContext,tabStream,"assistant");
 await Promise.all([micContext.resume(),tabContext.resume()]);
 emit({type:"FISH_AUDIO_COMPARE_STATUS",status:"monitoring",message:"Local microphone/Fish Audio comparison is running."});
}
function makeSegmenter(context,stream,role){
 const source=context.createMediaStreamSource(stream),node=new AudioWorkletNode(context,"fish-audio-capture",{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]}),gain=context.createGain();
 gain.gain.value=role==="assistant"?1:0;source.connect(node);node.connect(gain);gain.connect(context.destination);
 let frames=[],count=0,startedAt=0,lastLoudAt=0,recording=false;const rate=context.sampleRate;
 node.port.onmessage=ev=>{
  if(stopped)return;const samples=ev.data?.samples;if(!(samples instanceof Float32Array)||!samples.length)return;
  let energy=0;for(let i=0;i<samples.length;i++)energy+=samples[i]*samples[i];
  const rms=Math.sqrt(energy/samples.length),now=Date.now();
  if(rms>0.012){lastLoudAt=now;if(!recording){recording=true;startedAt=now;frames=[];count=0;}}
  if(!recording)return;frames.push(new Float32Array(samples));count+=samples.length;
  if(now-startedAt>12000||(now-lastLoudAt>750&&now-startedAt>400)){
   const saved=frames,duration=count/rate;recording=false;frames=[];count=0;
   if(duration>=0.4)queue=queue.then(()=>transcribe(saved,rate,role)).catch(e=>emit({type:"FISH_AUDIO_COMPARE_STATUS",status:"error",message:String(e?.message||e)}));
  }
 };
}
async function transcribe(frames,sourceRate,role){
 if(stopped)return;const wav=encodeWav(resample(frames,sourceRate,16000),16000);
 const response=await fetch("http://127.0.0.1:8765/transcribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({audio:bytesToBase64(wav),sample_rate:16000,role})});
 const result=await response.json();if(!response.ok||result.error)throw new Error(result.error||("Local transcriber HTTP "+response.status));
 if(role==="user"&&result.text)emit({type:"FISH_AUDIO_LOCAL_TRANSCRIPT",status:"user",text:result.text,message:"You said: "+result.text});
 if(role==="assistant"&&result.text){
  emit({type:"FISH_AUDIO_COMPARE_STATUS",status:result.status||"waiting",user:result.user||"",assistant:result.assistant||result.text,message:result.status==="mismatch"?"Transcript mismatch detected.":result.status==="match"?"Transcript match.":"Waiting for a comparable mic phrase."});
  if(result.status==="mismatch"&&Date.now()-lastMismatchAt>=COOLDOWN_MS){lastMismatchAt=Date.now();emit({type:"FISH_AUDIO_TRANSCRIPT_MISMATCH",user:result.user||"",assistant:result.assistant||result.text,at:lastMismatchAt});}
 }
}
function resample(frames,sourceRate,targetRate){
 const n=frames.reduce((sum,f)=>sum+f.length,0),source=new Float32Array(n);let offset=0;for(const f of frames){source.set(f,offset);offset+=f.length;}
 if(sourceRate===targetRate)return source;const size=Math.max(1,Math.floor(n*targetRate/sourceRate)),out=new Float32Array(size),ratio=sourceRate/targetRate;
 for(let i=0;i<size;i++){const p=i*ratio,l=Math.floor(p),r=Math.min(l+1,n-1),f=p-l;out[i]=source[l]*(1-f)+source[r]*f;}return out;
}
function encodeWav(samples,rate){
 const buffer=new ArrayBuffer(44+samples.length*2),v=new DataView(buffer),write=(at,str)=>{for(let i=0;i<str.length;i++)v.setUint8(at+i,str.charCodeAt(i));};
 write(0,"RIFF");v.setUint32(4,36+samples.length*2,true);write(8,"WAVE");write(12,"fmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);write(36,"data");v.setUint32(40,samples.length*2,true);
 let at=44;for(const s of samples){const x=Math.max(-1,Math.min(1,s));v.setInt16(at,x<0?x*32768:x*32767,true);at+=2;}return new Uint8Array(buffer);
}
function bytesToBase64(bytes){let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);}
function emit(message){chrome.runtime.sendMessage(message).catch(()=>{});}
function stop(){stopped=true;for(const stream of [micStream,tabStream])stream?.getTracks().forEach(t=>t.stop());for(const context of [micContext,tabContext])if(context&&context.state!=="closed")context.close().catch(()=>{});micStream=tabStream=micContext=tabContext=null;queue=Promise.resolve();}
