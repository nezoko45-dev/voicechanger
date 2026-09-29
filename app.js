const $=id=>document.getElementById(id);
const textInput=$("text"),playRef=$("playRef"),start=$("start"),stop=$("stop"),status=$("status");

let tts=null,voice=null,player=null,busy=false;

function setStatus(v){status.textContent=v;}

async function loadPocketTTS(){
 if(tts)return;
 setStatus("Loading PocketTTS... first load only.");
 const mod=await import("./pocket-tts/index.js");
 tts=new mod.PocketTTS({
  language:"english_2026-04",
  quantized:true,
  voiceCloning:true,
  cache:true,
  cacheName:"pocket-tts-safe-v2",
  maxThreads:2,
  deferSynthesis:true,
  maxReferenceSeconds:6,
  modelBaseUrl:"https://huggingface.co/akrv/pocket-tts-onnx/resolve/main/onnx",
  ortBaseUrl:"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/"
 });
 await tts.load(p=>{
  if(p.total)setStatus("Loading PocketTTS: "+Math.round(p.loaded/p.total*100)+"%");
 });
 const r=await fetch("./Recording%20(10).wav");
 if(!r.ok)throw new Error("Recording (10).wav could not be loaded.");
 const ctx=new AudioContext();
 const decoded=await ctx.decodeAudioData(await r.arrayBuffer());
 voice=await tts.cloneVoice(
  decoded.getChannelData(0).slice(),
  {inputSampleRate:decoded.sampleRate,name:"recording-10"}
 );
 await ctx.close();
 await tts.finishLoad();
 setStatus("PocketTTS ready.");
}

async function ensurePlayer(){
 if(!player){
  const mod=await import("./pocket-tts/index.js");
  player=new mod.StreamingPlayer({sampleRate:tts.sampleRate});
 }
 await player.resume();
}

async function playReference(){
 try{
  const audio=new Audio("./Recording%20(10).wav");
  audio.preload="auto";
  await audio.play();
  setStatus("Playing Recording (10).wav...");
  audio.onended=()=>setStatus("Ready.");
 }catch(e){
  setStatus("Reference playback error: "+(e.message||e));
 }
}

async function generate(){
 if(busy)return;
 const text=String(textInput.value||"").replace(/\s+/g," ").trim();
 if(!text){setStatus("Type something for the cloned voice to say.");textInput.focus();return;}
 busy=true;start.disabled=true;stop.disabled=false;
 try{
  await loadPocketTTS();
  await ensurePlayer();
  player.reset();
  let heard=false;
  setStatus("Generating PocketTTS...");
  await tts.generate(text,{voice,onChunk:chunk=>{
   if(!chunk?.length)return;
   player.play(chunk);
   if(!heard){heard=true;setStatus("Speaking...");}
  }});
  if(!heard)throw new Error("PocketTTS returned no audio.");
  player.flush();
  setStatus("Ready.");
 }catch(e){
  console.error(e);
  setStatus("PocketTTS error: "+(e.message||e));
 }finally{
  busy=false;start.disabled=false;stop.disabled=true;
 }
}

function stopPlayback(){
 if(player)player.stop();
 if(tts)tts.stop().catch(()=>{});
 busy=false;start.disabled=false;stop.disabled=true;setStatus("Stopped.");
}

playRef.onclick=playReference;
start.onclick=generate;
stop.onclick=stopPlayback;

textInput.addEventListener("keydown",e=>{
 if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();generate();}
});
