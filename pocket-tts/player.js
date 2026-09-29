// Persistent AudioWorklet PCM player for PocketTTS.
// PCM chunks are streamed directly into one browser audio pipeline.
// No WAV files and no per-chunk AudioBufferSourceNodes.
export class StreamingPlayer{
 constructor(opts={}){
  this.sampleRate=opts.sampleRate||24000;this.audioContext=opts.audioContext||null;
  this._ownsContext=!opts.audioContext;this._ready=false;this._node=null;this._workletUrl=null;
 }
 async resume(){
  if(!this.audioContext){const Ctx=globalThis.AudioContext||globalThis.webkitAudioContext;this.audioContext=new Ctx({sampleRate:this.sampleRate,latencyHint:"interactive"});}
  if(this.audioContext.state==="suspended")await this.audioContext.resume();
  if(this._ready)return;
  if(!this.audioContext.audioWorklet)throw new Error("AudioWorklet is not supported in this browser.");
  this._workletUrl=URL.createObjectURL(new Blob(["class PocketPCMProcessor extends AudioWorkletProcessor{\n constructor(){\n  super();this.queue=[];this.current=null;this.offset=0;\n  this.port.onmessage=e=>{const m=e.data||{};if(m.type===\"push\"&&m.audio){const a=new Float32Array(m.audio);if(a.length)this.queue.push(a);}else if(m.type===\"reset\"){this.queue=[];this.current=null;this.offset=0;}};\n }\n process(inputs,outputs){\n  const out=outputs[0]?.[0];if(!out)return true;out.fill(0);let w=0;\n  while(w<out.length){\n   if(!this.current||this.offset>=this.current.length){this.current=this.queue.shift()||null;this.offset=0;if(!this.current)break;}\n   const n=Math.min(out.length-w,this.current.length-this.offset);\n   out.set(this.current.subarray(this.offset,this.offset+n),w);this.offset+=n;w+=n;\n  }\n  return true;\n }\n}\nregisterProcessor(\"pocket-pcm\",PocketPCMProcessor);"],{type:"application/javascript"}));
  await this.audioContext.audioWorklet.addModule(this._workletUrl);
  this._node=new AudioWorkletNode(this.audioContext,"pocket-pcm",{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
  this._node.connect(this.audioContext.destination);this._ready=true;
 }
 play(float32){if(!float32?.length)return;if(!this._ready)throw new Error("StreamingPlayer is not ready.");const copy=new Float32Array(float32);this._node.port.postMessage({type:"push",audio:copy.buffer},[copy.buffer]);}
 flush(){}
 reset(){if(this._node)this._node.port.postMessage({type:"reset"});}
 stop(){this.reset();}
 async destroy(){this.reset();if(this._node){try{this._node.disconnect();}catch{}this._node=null;}if(this._workletUrl){URL.revokeObjectURL(this._workletUrl);this._workletUrl=null;}if(this._ownsContext&&this.audioContext){try{await this.audioContext.close();}catch{}this.audioContext=null;}this._ready=false;}
}
export function chunksToWavBlob(){throw new Error("WAV output is disabled; PocketTTS streams PCM directly.");}
