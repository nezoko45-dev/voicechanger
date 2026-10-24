import { pipeline, env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
const $ = id => document.getElementById(id);
let stt=null, tts=null, loaded=false, listening=false, busy=false, lastText="", stream=null, ctx=null, analyser=null, source=null, raf=0, recorder=null, slices=[], speechActive=false, lastLoud=0, segmentBusy=false;
function status(s){$("status").textContent=s} function state(s){$("state").textContent=s}
function progress(p){$("progressbar").style.width=Math.max(0,Math.min(100,p))+"%"}
async function refreshMics(){try{const tmp=await navigator.mediaDevices.getUserMedia({audio:true});tmp.getTracks().forEach(t=>t.stop());const ds=await navigator.mediaDevices.enumerateDevices(),sel=$("mic"),old=sel.value;sel.innerHTML='<option value="">System default</option>';ds.filter(d=>d.kind==="audioinput").forEach((d,i)=>{const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||"Microphone "+(i+1);sel.appendChild(o)});if([...sel.options].some(o=>o.value===old))sel.value=old}catch(e){status("Microphone permission: "+e.message)}}
async function loadModels(){
 $("load").disabled=true;state("Loading");status("Loading Whisper model. First launch downloads model files.");progress(5);
 try{
  env.allowLocalModels=false;env.useBrowserCache=true;
  const wantGpu=$("gpu").checked;
  try{stt=await pipeline("automatic-speech-recognition",$("asr").value,{device:wantGpu?"webgpu":"wasm",dtype:wantGpu?"fp32":"q8",progress_callback:p=>{if(typeof p.progress==="number")progress(p.progress)}});$("engine").textContent="Whisper: "+(wantGpu?"WebGPU requested":"WASM")}
  catch(e){if(!wantGpu)throw e;status("Whisper WebGPU failed; retrying with WASM…");stt=await pipeline("automatic-speech-recognition",$("asr").value,{device:"wasm",dtype:"q8"});$("engine").textContent="Whisper: WASM fallback"}
  status("Loading Kokoro TTS model…");progress(55);
  try{tts=await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX",{device:wantGpu?"webgpu":"wasm",dtype:wantGpu?"fp32":"q8"});$("engine").textContent+=" · Kokoro: "+(wantGpu?"WebGPU requested":"WASM")}
  catch(e){if(!wantGpu)throw e;status("Kokoro WebGPU failed; retrying with WASM…");tts=await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX",{device:"wasm",dtype:"q8"});$("engine").textContent+=" · Kokoro: WASM fallback"}
  loaded=true;progress(100);state("Ready");status("Models loaded. Choose a microphone and press Start listening.");$("start").disabled=false;$("repeat").disabled=false;$("asr").disabled=true;$("gpu").disabled=true;
 }catch(e){console.error(e);state("Load failed");status("Could not load models: "+e.message);$("load").disabled=false;progress(0)}
}
async function startListening(){
 if(!loaded||listening)return;
 try{
  stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:$("mic").value?{exact:$("mic").value}:undefined,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  const mime=["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"].find(x=>MediaRecorder.isTypeSupported(x));
  recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});slices=[];recorder.ondataavailable=e=>{if(e.data?.size)slices.push(e.data)};recorder.start(200);
  ctx=new AudioContext();analyser=ctx.createAnalyser();analyser.fftSize=2048;source=ctx.createMediaStreamSource(stream);source.connect(analyser);
  listening=true;speechActive=false;lastLoud=performance.now();$("start").disabled=true;$("stop").disabled=false;$("mic").disabled=true;state("Listening");status("Listening — speak, then pause briefly.");monitor()
 }catch(e){status("Microphone error: "+e.message)}
}
function monitor(){
 if(!listening||!analyser)return;const a=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(a);let sum=0;for(const n of a){const v=(n-128)/128;sum+=v*v}const rms=Math.sqrt(sum/a.length);$("levelbar").style.width=Math.min(100,rms*500)+"%";$("level").textContent="Microphone level: "+Math.round(rms*100)+"%";const now=performance.now();
 if(rms>.018){speechActive=true;lastLoud=now}
 if(speechActive&&now-lastLoud>950&&!segmentBusy&&!busy){speechActive=false;segmentBusy=true;const blob=new Blob(slices,{type:recorder?.mimeType||"audio/webm"});slices=[];if(recorder?.state==="recording")recorder.requestData();processAudio(blob).catch(e=>status("Transcription failed: "+e.message)).finally(()=>{segmentBusy=false;if(listening&&!busy)status("Listening — speak, then pause briefly.")})}
 if(!speechActive&&slices.length>12)slices=slices.slice(-5);raf=requestAnimationFrame(monitor)
}
function mixChannels(b){const out=new Float32Array(b.length);for(let c=0;c<b.numberOfChannels;c++){const d=b.getChannelData(c);for(let i=0;i<d.length;i++)out[i]+=d[i]/b.numberOfChannels}return out}
function resample(input,from,to){if(from===to)return input;const ratio=from/to,len=Math.floor(input.length/ratio),out=new Float32Array(len);for(let i=0;i<len;i++){const a=Math.floor(i*ratio),b=Math.min(Math.floor((i+1)*ratio),input.length);let s=0;for(let j=a;j<b;j++)s+=input[j];out[i]=s/Math.max(1,b-a)}return out}
async function processAudio(blob){
 if(!listening||!stt||blob.size<4000)return;status("Transcribing locally…");let ac;
 try{ac=new AudioContext();const decoded=await ac.decodeAudioData(await blob.arrayBuffer());const mono=decoded.numberOfChannels===1?decoded.getChannelData(0):mixChannels(decoded);const samples=resample(mono,decoded.sampleRate,16000);await ac.close();ac=null;const result=await stt(samples,{sampling_rate:16000});const text=(result.text||"").trim();if(!text)return;lastText=text;$("transcript").textContent=text;if($("auto").checked)await speak(text)}
 finally{if(ac)await ac.close()}
}
function wavBlob(samples,rate){const d=samples instanceof Float32Array?samples:new Float32Array(samples),buf=new ArrayBuffer(44+d.length*2),v=new DataView(buf),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};w(0,"RIFF");v.setUint32(4,36+d.length*2,true);w(8,"WAVE");w(12,"fmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,"data");v.setUint32(40,d.length*2,true);for(let i=0;i<d.length;i++){const s=Math.max(-1,Math.min(1,d[i]));v.setInt16(44+i*2,s<0?s*32768:s*32767,true)}return new Blob([buf],{type:"audio/wav"})}
async function speak(text){
 if(!tts||!text.trim())return;const resume=listening;
 if($("pause").checked&&listening)pauseCapture();
 busy=true;state("Speaking");status("Generating Kokoro speech…");
 try{const out=await tts.generate(text,{voice:$("voice").value});const samples=out.audio||out;const rate=out.sampling_rate||out.sampleRate||24000;const url=URL.createObjectURL(wavBlob(samples,rate));const player=new Audio(url);await new Promise((resolve,reject)=>{player.onended=resolve;player.onerror=()=>reject(new Error("Audio playback failed"));player.play().catch(reject)});URL.revokeObjectURL(url)}
 catch(e){status("Kokoro TTS failed: "+e.message)}
 finally{busy=false;if(resume&&$("pause").checked)resumeCapture();else if(listening){state("Listening");status("Listening — speak, then pause briefly.")}else{state("Ready");status("Ready.")}}
}
function pauseCapture(){listening=false;cancelAnimationFrame(raf);if(ctx){ctx.close();ctx=null}analyser=null;source=null;if(recorder?.state==="recording")recorder.pause()}
function resumeCapture(){if(!stream)return;if(recorder?.state==="paused")recorder.resume();ctx=new AudioContext();analyser=ctx.createAnalyser();analyser.fftSize=2048;source=ctx.createMediaStreamSource(stream);source.connect(analyser);listening=true;speechActive=false;lastLoud=performance.now();state("Listening");status("Listening — speak, then pause briefly.");monitor()}
function stopListening(){listening=false;cancelAnimationFrame(raf);if(recorder&&recorder.state!=="inactive")try{recorder.stop()}catch{};stream?.getTracks().forEach(t=>t.stop());if(ctx)ctx.close();ctx=null;stream=null;analyser=null;source=null;recorder=null;slices=[];$("start").disabled=!loaded;$("stop").disabled=true;$("mic").disabled=false;state(loaded?"Ready":"Stopped");status("Listening stopped.")}
$("load").addEventListener("click",loadModels);$("start").addEventListener("click",startListening);$("stop").addEventListener("click",stopListening);$("repeat").addEventListener("click",()=>lastText?speak(lastText):status("Nothing to repeat yet."));navigator.mediaDevices?.addEventListener?.("devicechange",refreshMics);refreshMics();
