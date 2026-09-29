// Browser-native streaming player for PocketTTS.
// PocketTTS produces Float32 PCM chunks in a Web Worker. This player schedules
// those chunks directly on a Web Audio clock instead of assembling a WAV or
// sending PCM to the old Windows backend.

export class StreamingPlayer{
 constructor(opts={}){
  this.sampleRate=opts.sampleRate||24000;
  this.playbackRate=opts.playbackRate||1.2;
  this.audioContext=null;
  this.nextStartTime=0;
  this.started=false;
  this.pending=[];
  this.scheduled=[];
  this.minLead=0.03;
  this.deviceId="";
  this.gainNode=null;
 }

 async resume(){
  if(!this.audioContext){
   this.audioContext=new AudioContext({latencyHint:"interactive"});
   this.gainNode=this.audioContext.createGain();
   this.gainNode.gain.value=1.25;
   this.gainNode.connect(this.audioContext.destination);
   if(this.deviceId)await this.setSinkId(this.deviceId);
  }
  if(this.audioContext.state!=="running")await this.audioContext.resume();
  if(this.audioContext.state!=="running")throw new Error("Chrome audio output is suspended.");
  this.started=true;
  this.nextStartTime=Math.max(this.nextStartTime,this.audioContext.currentTime+this.minLead);
 }

 async setSinkId(deviceId=""){
  this.deviceId=deviceId||"";
  if(!this.audioContext)return;
  if(typeof this.audioContext.setSinkId==="function"){
   await this.audioContext.setSinkId(this.deviceId||"default");
  }
 }

 setPlaybackRate(rate=1.2){
  this.playbackRate=Math.max(0.5,Math.min(2.0,Number(rate)||1.2));
 }

 play(float32,meta){
  if(!float32?.length)return;
  if(!this.audioContext)throw new Error("PocketTTS StreamingPlayer has not been resumed.");
  if(this.audioContext.state!=="running")void this.audioContext.resume().catch(()=>{});

  const data=float32 instanceof Float32Array?float32:new Float32Array(float32);
  const buffer=this.audioContext.createBuffer(1,data.length,this.sampleRate);
  buffer.copyToChannel(data,0);

  const source=this.audioContext.createBufferSource();
  source.buffer=buffer;
  source.playbackRate.value=this.playbackRate;
  source.connect(this.gainNode||this.audioContext.destination);

  const now=this.audioContext.currentTime;
  const startTime=Math.max(now+0.008,this.nextStartTime||now+this.minLead);
  source.start(startTime);

  // Schedule using the compressed playback duration, not the original
  // generated-buffer duration. This prevents the generated audio queue from
  // falling behind while speech is still arriving.
  this.nextStartTime=startTime+(buffer.duration/this.playbackRate);
  this.scheduled.push(source);
  source.onended=()=>{
   const i=this.scheduled.indexOf(source);
   if(i>=0)this.scheduled.splice(i,1);
   try{source.disconnect();}catch{}
  };
 }

 flush(){
  if(!this.audioContext)return;
  if(this.nextStartTime<this.audioContext.currentTime)
   this.nextStartTime=this.audioContext.currentTime;
 }

 reset(){
  this.stop();
  this.pending=[];
  this.scheduled=[];
  this.nextStartTime=0;
 }

 stop(){
  for(const source of this.scheduled){
   try{source.stop();}catch{}
   try{source.disconnect();}catch{}
  }
  this.scheduled=[];
  if(this.audioContext){
   this.nextStartTime=this.audioContext.currentTime;
  }
 }

 async destroy(){
  this.stop();
  if(this.audioContext){
   try{await this.audioContext.close();}catch{}
  }
  this.audioContext=null;
  this.gainNode=null;
  this.started=false;
 }
}

export function chunksToWavBlob(){
 throw new Error("WAV assembly is disabled. PocketTTS uses direct streaming playback.");
}
