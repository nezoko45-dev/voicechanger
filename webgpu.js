const $=id=>document.getElementById(id);
const inputWav=$("inputWav"),model=$("model"),output=$("output"),chooseOutput=$("chooseOutput"),start=$("start"),stop=$("stop"),player=$("player"),download=$("download"),status=$("status"),diagnostic=$("diagnostic");
let ort=null,session=null,stopped=false,blobUrl=null;

const setStatus=v=>status.textContent=v;
function setDiag(v){diagnostic.textContent=v;}

async function checkGPU(){
 if(!navigator.gpu)throw new Error("Chrome WebGPU is unavailable. Open this page in current Chrome/Edge with WebGPU enabled.");
 const adapter=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});
 if(!adapter)throw new Error("Chrome exposed WebGPU, but no compatible GPU adapter was found.");
 return {info:adapter.info||{}};
}
async function loadOutputs(){
 const ds=await navigator.mediaDevices?.enumerateDevices?.()||[];
 const old=output.value;
 output.innerHTML="<option value=''>Default Windows output</option>";
 for(const d of ds.filter(x=>x.kind==="audiooutput")){
  const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||("Speaker / output "+output.options.length);output.appendChild(o);
 }
 if([...output.options].some(x=>x.value===old))output.value=old;
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
function readWav(buffer){
 const v=new DataView(buffer);
 if(v.byteLength<44||v.getUint32(0,false)!==0x52494646||v.getUint32(8,false)!==0x57415645)throw new Error("Input is not a RIFF/WAVE file.");
 let pos=12,fmt=null,data=null;
 while(pos+8<=v.byteLength){
  const id=v.getUint32(pos,false),size=v.getUint32(pos+4,true),chunkStart=pos+8;pos=chunkStart;
  if(id===0x666d7420){
   if(size<16||pos+16>v.byteLength)throw new Error("Invalid WAV fmt chunk.");
   fmt={audioFormat:v.getUint16(pos,true),channels:v.getUint16(pos+2,true),sampleRate:v.getUint32(pos+4,true),bits:v.getUint16(pos+14,true)};
  }else if(id===0x64617461)data={offset:pos,size:Math.min(size,v.byteLength-pos)};
  pos+=size+(size&1);
 }
 if(!fmt||!data)throw new Error("WAV is missing fmt or data chunk.");
 if(fmt.audioFormat!==1||fmt.bits!==16)throw new Error("Use a PCM 16-bit WAV file.");
 if(fmt.channels<1)throw new Error("WAV has no audio channels.");
 const frames=Math.floor(data.size/(fmt.channels*2)),out=new Float32Array(frames);
 let p=data.offset;
 for(let i=0;i<frames;i++){
  let sum=0;
  for(let c=0;c<fmt.channels;c++){sum+=v.getInt16(p,true)/32768;p+=2;}
  out[i]=sum/fmt.channels;
 }
 return {samples:out,sampleRate:fmt.sampleRate};
}
function pcmToWav(samples,sr){
 const b=new ArrayBuffer(44+samples.length*2),v=new DataView(b),w=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
 w(0,"RIFF");v.setUint32(4,36+samples.length*2,true);w(8,"WAVE");w(12,"fmt ");
 v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);
 v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,"data");v.setUint32(40,samples.length*2,true);
 let p=44;for(const x of samples){const s=Math.max(-1,Math.min(1,x));v.setInt16(p,s<0?s*32768:s*32767,true);p+=2;}
 return new Blob([b],{type:"audio/wav"});
}
async function initModel(){
 const {info}=await checkGPU();
 ort=await import("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/webgpu/+esm");
 const file=model.files?.[0];if(!file)throw new Error("Choose an ONNX voice-conversion model first.");
 const bytes=await file.arrayBuffer();
 setStatus("Creating ONNX Runtime WebGPU session…");
 session=await ort.InferenceSession.create(bytes,{executionProviders:["webgpu"],graphOptimizationLevel:"all"});
 setDiag("GPU: "+(info?.vendor||"unknown")+" "+(info?.architecture||"")+
 "\nExecution provider: WEBGPU ONLY"+
 "\nInputs: "+session.inputNames.join(", ")+
 "\nOutputs: "+session.outputNames.join(", ")+
 "\n\nWASM is not registered.");
 if(session.inputNames.length!==1||session.outputNames.length!==1)
  throw new Error("This model exposes "+session.inputNames.length+" inputs and "+session.outputNames.length+" outputs. This WAV build requires one audio input and one audio output.");
}
async function convert(){
 stopped=false;start.disabled=true;stop.disabled=false;download.hidden=true;
 if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null;}
 try{
  const file=inputWav.files?.[0];if(!file)throw new Error("Choose an input WAV file first.");
  await initModel();
  setStatus("Reading input WAV…");
  const wav=readWav(await file.arrayBuffer());
  if(wav.samples.length===0)throw new Error("The input WAV contains no samples.");
  setStatus("Running WebGPU voice conversion…");
  const name=session.inputNames[0];
  const tensor=new ort.Tensor("float32",wav.samples,[1,wav.samples.length]);
  const result=await session.run({[name]:tensor});
  if(stopped)return;
  const out=result[session.outputNames[0]];
  if(!out?.data)throw new Error("The ONNX model returned no audio output.");
  const samples=Float32Array.from(out.data);
  const outBlob=pcmToWav(samples,wav.sampleRate);
  blobUrl=URL.createObjectURL(outBlob);
  await setSink();
  player.src=blobUrl;player.load();
  download.href=blobUrl;download.download=(file.name.replace(/\.wav$/i,"")||"converted")+"_converted.wav";download.hidden=false;
  setStatus("Conversion complete — WAV ready to play or download.");
  try{await player.play();}catch{setStatus("Conversion complete — press Play on the converted WAV player.");}
 }catch(e){
  console.error(e);setStatus("WAV conversion failed: "+(e.message||e));
 }finally{
  stop.disabled=true;start.disabled=false;
 }
}
function stopAll(){
 stopped=true;stop.disabled=true;start.disabled=false;
 if(player){player.pause();player.removeAttribute("src");player.load();}
 setStatus("Stopped.");
}
chooseOutput.onclick=chooseSpeaker;start.onclick=()=>void convert();stop.onclick=stopAll;output.onchange=()=>void setSink();
navigator.mediaDevices?.addEventListener?.("devicechange",loadOutputs);
void loadOutputs();