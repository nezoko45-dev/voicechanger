import { ChatterboxTTSEngine, audioArrayToWav } from "./chatterbox-turbo-engine.js";

let engine = new ChatterboxTTSEngine();
let referenceAudio = null;

self.addEventListener("message", async event => {
 const { type, data } = event.data || {};
 try {
  if (type === "load") {
   await engine.initialize(progress => self.postMessage({type:"progress",data:progress}), false);
   self.postMessage({type:"loaded",data:{device:navigator.gpu?"webgpu":"wasm"}});
  } else if (type === "encode") {
   referenceAudio = new Float32Array(data.audio);
   if (!referenceAudio.length) throw new Error("The reference WAV contains no audio.");
   self.postMessage({type:"speaker-ready",data:{samples:referenceAudio.length}});
  } else if (type === "generate") {
   if (!referenceAudio) throw new Error("Upload your reference WAV again.");
   const result = await engine.generate(data.text, referenceAudio, {
    maxNewTokens: 1024,
    temperature: Number(data.temperature ?? 0.2),
    repetitionPenalty: Number(data.repetitionPenalty ?? 1.2),
    progressCallback: progress => self.postMessage({type:"generation-progress",data:progress})
   });
   const samples = result.audio;
   const buffer = samples.buffer.slice(samples.byteOffset,samples.byteOffset+samples.byteLength);
   self.postMessage({type:"audio",data:buffer},[buffer]);
  } else {
   throw new Error("Unknown worker action: "+type);
  }
 } catch(error) {
  self.postMessage({type:"failure",data:{message:error?.message||String(error)}});
 }
});
