class Downsampler extends AudioWorkletProcessor {
  constructor(options){
    super();
    this.target=options.processorOptions.targetRate||16000;
    this.buffer=[];
    this.position=0;
  }
  process(inputs){
    const input=inputs[0]?.[0];
    if(!input) return true;
    for(let i=0;i<input.length;i++) this.buffer.push(input[i]);
    const ratio=sampleRate/this.target;
    const out=[];
    while(this.position+1 < this.buffer.length){
      const i=Math.floor(this.position);
      const frac=this.position-i;
      out.push(this.buffer[i]*(1-frac)+this.buffer[i+1]*frac);
      this.position+=ratio;
    }
    const consumed=Math.max(0,Math.floor(this.position)-1);
    if(consumed){this.buffer.splice(0,consumed);this.position-=consumed;}
    if(out.length) this.port.postMessage(new Float32Array(out),[new Float32Array(out).buffer]);
    return true;
  }
}
registerProcessor("downsampler",Downsampler);