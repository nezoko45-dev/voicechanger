import { ChatterboxModel, AutoProcessor, Tensor } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0';

const MODEL_ID = 'onnx-community/chatterbox-ONNX';
let model = null;
let processor = null;
const speakers = new Map();

async function webgpuAvailable(){
  if(!navigator.gpu) return false;
  try{return !!(await navigator.gpu.requestAdapter())}catch{return false}
}

const DTYPE={
  wasm:{embed_tokens:'fp32',speech_encoder:'fp32',language_model:'q4',conditional_decoder:'fp32'},
  webgpu:{embed_tokens:'fp32',speech_encoder:'fp32',language_model:'q4f16',conditional_decoder:'fp32'}
};

async function load({device}={}){
  const gpu=await webgpuAvailable();
  const dev=device||(gpu?'webgpu':'wasm');
  processor=await AutoProcessor.from_pretrained(MODEL_ID);
  model=await ChatterboxModel.from_pretrained(MODEL_ID,{
    device:dev,
    dtype:DTYPE[dev]||DTYPE.wasm,
    progress_callback:p=>self.postMessage({type:'progress',data:p})
  });
  self.postMessage({type:'loaded',data:{device:dev,webgpu:gpu}});
}

async function encode({id,audio}){
  if(!model) throw new Error('Model is not loaded');
  const x=new Float32Array(audio);
  const tensor=new Tensor('float32',x,[1,x.length]);
  const result=await model.encode_speech(tensor);
  speakers.set(id,result);
  self.postMessage({type:'encoded',data:{id}});
}

async function generate({text,id,exaggeration=0.5}){
  if(!model||!processor) throw new Error('Model is not loaded');
  const cond=speakers.get(id);
  if(!cond) throw new Error('Reference voice has not been encoded');
  const inputs=await processor._call(text);
  const wav=await model.generate({...inputs,...cond,exaggeration,max_new_tokens:256});
  const data=wav.data;
  const buffer=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
  self.postMessage({type:'generated',data:{audio:buffer,sampleRate:24000}},[buffer]);
}

self.onmessage=async e=>{
  try{
    const {type,data}=e.data;
    if(type==='load') await load(data);
    else if(type==='encode') await encode(data);
    else if(type==='generate') await generate(data);
  }catch(err){self.postMessage({type:'error',data:{message:err?.message||String(err),stack:err?.stack||''}})}
};
