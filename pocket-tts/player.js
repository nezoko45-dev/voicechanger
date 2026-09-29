// Reliable local PocketTTS PCM playback.
// Each generated PCM chunk is scheduled into one browser AudioContext.
// The audio never leaves the local browser for playback.
export class StreamingPlayer{
 constructor(opts={}){
  this.sampleRate=opts.sampleRate||24000;
  this.audioContext=opts.audioContext||null;
  this._ownsContext=!opts.audioContext;
  this._ready=false;
  this._nextTime=0;
  this._sources=new Set();
 }
 async resume(){
  if(!this.audioContext){
   const Ctx=globalThis.AudioContext||globalThis.webkitAudioContext;
   if(!Ctx)throw new Error("Web Audio is not supported in this browser.");
   this.audioContext=new Ctx({sampleRate:this.sampleRate,latencyHint:"interactive"});
  }
  if(this.audioContext.state==="suspended")await this.audioContext.resume();
  if(this.audioContext.state!=="running")throw new Error("Browser audio output is not running.");
  this._ready=true;
  if(this._nextTime<this.audioContext.currentTime)this._nextTime=this.audioContext.currentTime+0.02;
 }
 play(float32){
  if(!float32?.length)return;
  if(!this._ready)throw new Error("StreamingPlayer is not ready.");
  const ctx=this.audioContext;
  if(ctx.state==="suspended")return;
  const audio=new Float32Array(float32);
  const buffer=ctx.createBuffer(1,audio.length,this.sampleRate);
  buffer.copyToChannel(audio,0);
  const source=ctx.createBufferSource();
  source.buffer=buffer;
  source.connect(ctx.destination);
  const now=ctx.currentTime;
  if(this._nextTime<now+0.01)this._nextTime=now+0.01;
  const startAt=this._nextTime;
  source.start(startAt);
  this._nextTime=startAt+buffer.duration;
  this._sources.add(source);
  source.onended=()=>{this._sources.delete(source);source.disconnect();};
 }
 flush(){}
 reset(){
  for(const source of this._sources){try{source.stop();}catch{}try{source.disconnect();}catch{}}
  this._sources.clear();
  if(this.audioContext)this._nextTime=this.audioContext.currentTime+0.02;
 }
 stop(){this.reset();}
 async destroy(){
  this.reset();
  if(this._ownsContext&&this.audioContext){
   try{await this.audioContext.close();}catch{}
  }
  this.audioContext=null;
  this._ready=false;
 }
}
export function chunksToWavBlob(){throw new Error("WAV output is disabled; PocketTTS streams PCM directly.");}
