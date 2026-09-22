const $=id=>document.getElementById(id);
const status=$("status"), transcript=$("transcript");
let running=false,ctx=null,stream=null,source=null,processor=null,stt=null,tts=null,ttsReady=false;
let playAt=0,sttKeepAlive=null;

function say(t,k=""){status.textContent=t;status.className="status "+k}
function authProtocols(token){return ["token",token]}
function int16ToFloat32(buf){
 const a=new Int16Array(buf),out=new Float32Array(a.length);
 for(let i=0;i<a.length;i++)out[i]=Math.max(-1,Math.min(1,a[i]/32768));
 return out;
}
function playPCM16(data,sampleRate=48000){
 if(!ctx||!running)return;
 const f=int16ToFloat32(data),b=ctx.createBuffer(1,f.length,sampleRate);
 b.copyToChannel(f,0);
 const s=ctx.createBufferSource();s.buffer=b;s.connect(ctx.destination);
 const now=ctx.currentTime;
 if(playAt<now)playAt=now+0.015;
 s.start(playAt);playAt+=b.duration;
}
function downsampleTo16k(input,inRate){
 const ratio=inRate/16000;
 const len=Math.floor(input.length/ratio),out=new Int16Array(len);
 for(let i=0;i<len;i++){
   const pos=i*ratio,idx=Math.floor(pos),frac=pos-idx;
   const a=input[idx]||0,b=input[idx+1]||a,v=a+(b-a)*frac;
   out[i]=Math.max(-32768,Math.min(32767,Math.round(v*32767)));
 }
 return out.buffer;
}
function makeProcessor(){
 const p=ctx.createScriptProcessor(4096,1,1);
 p.onaudioprocess=e=>{
   if(!running||!stt||stt.readyState!==WebSocket.OPEN)return;
   const mono=e.inputBuffer.getChannelData(0);
   const pcm=downsampleTo16k(mono,ctx.sampleRate);
   if(pcm.byteLength)stt.send(pcm);
 };
 const mute=ctx.createGain();mute.gain.value=0;
 source.connect(p);p.connect(mute);mute.connect(ctx.destination);
 return p;
}
function connectTTS(token){
 return new Promise((resolve,reject)=>{
   const model=$("voice").value.trim()||"aura-2-asteria-en";
   tts=new WebSocket("wss://api.deepgram.com/v1/speak?model="+encodeURIComponent(model)+"&encoding=linear16&sample_rate=48000",authProtocols(token));
   tts.binaryType="arraybuffer";
   tts.onopen=()=>{ttsReady=true;say("STT + TTS connected. Listening continuously.","ok");resolve()};
   tts.onmessage=e=>{
     if(typeof e.data==="string"){
       try{const m=JSON.parse(e.data);if(m.type==="Metadata")return;if(m.type==="Flushed")return;if(m.type==="Warning")say("TTS warning: "+m.description,"err")}catch{}
       return;
     }
     if(e.data instanceof ArrayBuffer)playPCM16(e.data,48000);
     else if(e.data?.arrayBuffer)e.data.arrayBuffer().then(b=>playPCM16(b,48000));
   };
   tts.onerror=()=>reject(Error("Deepgram TTS WebSocket error."));
   tts.onclose=()=>{ttsReady=false;if(running)say("TTS WebSocket closed.","err")};
 });
}
function connectSTT(token){
 return new Promise((resolve,reject)=>{
   const url="wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&endpointing=300&utterance_end_ms=1000&smart_format=true";
   stt=new WebSocket(url,authProtocols(token));stt.binaryType="arraybuffer";
   stt.onopen=()=>{say("STT connected. Microphone is streaming continuously.","ok");resolve()};
   stt.onmessage=e=>{
     let m;try{m=JSON.parse(e.data)}catch{return}
     if(m.type!=="Results")return;
     const alt=m.channel?.alternatives?.[0],text=alt?.transcript?.trim()||"";
     if(text)transcript.textContent=text;
     if(m.is_final&&m.speech_final&&text&&ttsReady){
       tts.send(JSON.stringify({type:"Speak",text}));
       tts.send(JSON.stringify({type:"Flush"}));
     }
   };
   stt.onerror=()=>reject(Error("Deepgram STT WebSocket error."));
   stt.onclose=()=>{if(running)say("STT WebSocket closed.","err")};
 });
}
async function start(){
 const token=$("key").value.trim();
 if(!token)return say("Paste your Deepgram API key or temporary token first.","err");
 try{
   $("start").disabled=true;$("stop").disabled=false;running=true;playAt=0;
   ctx=new AudioContext({latencyHint:"interactive"});await ctx.resume();
   stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
   source=ctx.createMediaStreamSource(stream);
   await connectSTT(token);await connectTTS(token);
   processor=makeProcessor();
   sttKeepAlive=setInterval(()=>{if(stt?.readyState===WebSocket.OPEN)stt.send(JSON.stringify({type:"KeepAlive"}))},8000);
   say("Continuous STT is ON. Speak normally.","ok");
 }catch(e){stop();say("Start error: "+e.message,"err")}
}
function stop(){
 running=false;
 if(sttKeepAlive)clearInterval(sttKeepAlive);sttKeepAlive=null;
 try{if(stt?.readyState===WebSocket.OPEN)stt.send(JSON.stringify({type:"CloseStream"}))}catch{}
 try{if(tts?.readyState===WebSocket.OPEN)tts.send(JSON.stringify({type:"Close"}))}catch{}
 try{processor?.disconnect()}catch{}try{source?.disconnect()}catch{}
 try{stream?.getTracks().forEach(t=>t.stop())}catch{}
 try{ctx?.close()}catch{}
 stt=null;tts=null;ttsReady=false;processor=null;source=null;stream=null;ctx=null;
 $("stop").disabled=true;$("start").disabled=false;say("Stopped.");
}
$("start").onclick=start;$("stop").onclick=stop;addEventListener("beforeunload",stop);