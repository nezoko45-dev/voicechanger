// PocketTTS PCM transport to the local Windows audio backend.
// Chrome generates the voice; Node handles the final Windows speaker playback.
export class StreamingPlayer{
 constructor(opts={}){
  this.sampleRate=opts.sampleRate||24000;
  this.socket=null;
  this._ready=false;
 }
 async resume(){
  if(this._ready&&this.socket?.readyState===WebSocket.OPEN)return;
  await new Promise((resolve,reject)=>{
   const ws=new WebSocket("ws://127.0.0.1:8788");
   ws.binaryType="arraybuffer";
   ws.onopen=()=>{this.socket=ws;this._ready=true;resolve();};
   ws.onerror=()=>reject(new Error("Local Windows audio backend is not running. Start start_pockettts.bat first."));
   ws.onclose=()=>{this._ready=false;};
  });
 }
 play(float32){
  if(!float32?.length)return;
  if(!this._ready||this.socket?.readyState!==WebSocket.OPEN)
   throw new Error("Local Windows audio backend is disconnected.");
  const audio=new Float32Array(float32);
  this.socket.send(audio.buffer);
 }
 flush(){}
 reset(){}
 stop(){
  if(this.socket){
   try{this.socket.close();}catch{}
  }
  this.socket=null;
  this._ready=false;
 }
 async destroy(){this.stop();}
}
export function chunksToWavBlob(){throw new Error("WAV output is disabled; PocketTTS streams PCM to the local Windows backend.");}
