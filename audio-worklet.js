class FishAudioCaptureProcessor extends AudioWorkletProcessor {
 constructor(){super();this.blockSize=2048;this.buffer=new Float32Array(this.blockSize);this.offset=0;}
 process(inputs,outputs){
  const input=inputs[0]?.[0],output=outputs[0]?.[0];if(output){if(input)output.set(input);else output.fill(0);}
  if(input){let i=0;while(i<input.length){const n=Math.min(this.blockSize-this.offset,input.length-i);this.buffer.set(input.subarray(i,i+n),this.offset);this.offset+=n;i+=n;if(this.offset===this.blockSize){const block=this.buffer;this.buffer=new Float32Array(this.blockSize);this.offset=0;this.port.postMessage({samples:block},[block.buffer]);}}}
  return true;
 }
}
registerProcessor("fish-audio-capture",FishAudioCaptureProcessor);
