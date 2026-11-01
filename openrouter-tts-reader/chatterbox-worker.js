let engine = null;
let referenceAudio = null;
let audioArrayToWav = null;

self.addEventListener("message", async event => {
 const { type, data } = event.data || {};
 try {
  if (type === "load") {
   // Load the engine dynamically so CDN/module import failures can be reported
   // back to the page instead of killing the worker before its handler exists.
   if (!engine) {
    self.postMessage({type:"progress",data:{message:"Starting Chatterbox engine and loading browser dependencies…",status:"loading"}});
    const module = await import("./chatterbox-turbo-engine.js");
    engine = new module.ChatterboxTTSEngine();
    audioArrayToWav = module.audioArrayToWav;
   }
   await engine.initialize(progress => self.postMessage({type:"progress",data:progress}), true);
   self.postMessage({type:"loaded",data:{device:navigator.gpu?"webgpu":"wasm"}});
  } else if (type === "encode") {
   if (!engine) throw new Error("Load the Chatterbox model before uploading a WAV.");
   referenceAudio = new Float32Array(data.audio);
   if (!referenceAudio.length) throw new Error("The reference WAV contains no audio.");
   self.postMessage({type:"speaker-ready",data:{samples:referenceAudio.length}});
  } else if (type === "generate") {
   if (!engine || !referenceAudio) throw new Error("Load the model and upload your reference WAV again.");
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
  const message = error?.stack || error?.message || String(error);
  self.postMessage({type:"failure",data:{message}});
 }
});
