import { ChatterboxModel, AutoProcessor, Tensor } from "https://esm.sh/@huggingface/transformers@4.0.0-next.2";

const MODEL_ID = "onnx-community/chatterbox-ONNX";
let model = null;
let processor = null;
let speakerCache = new Map();

async function load() {
  const webgpu = !!navigator.gpu && !!(await navigator.gpu.requestAdapter());
  const device = webgpu ? "webgpu" : "wasm";
  const dtype = device === "webgpu"
    ? { embed_tokens: "fp32", speech_encoder: "fp32", language_model: "q4f16", conditional_decoder: "fp32" }
    : { embed_tokens: "fp32", speech_encoder: "fp32", language_model: "q4", conditional_decoder: "fp32" };

  processor = await AutoProcessor.from_pretrained(MODEL_ID, {
    progress_callback: p => self.postMessage({ type: "progress", data: p })
  });
  model = await ChatterboxModel.from_pretrained(MODEL_ID, {
    device, dtype,
    progress_callback: p => self.postMessage({ type: "progress", data: p })
  });
  self.postMessage({ type: "loaded", data: { device, webgpu } });
}

async function encodeSpeaker(data) {
  if (!model) throw new Error("Load the speech model first.");
  const audio = new Float32Array(data.audio);
  if (!audio.length) throw new Error("The reference WAV contains no audio.");
  const tensor = new Tensor("float32", audio, [1, audio.length]);
  const embeddings = await model.encode_speech(tensor);
  speakerCache.set(data.id, embeddings);
  self.postMessage({ type: "speaker-ready", data: { id: data.id } });
}

async function generate(data) {
  if (!model || !processor) throw new Error("The speech model is not ready.");
  const speaker = speakerCache.get(data.id);
  if (!speaker) throw new Error("Upload your reference WAV again to encode its voice.");
  const inputs = await processor._call(data.text);
  const waveform = await model.generate({
    ...inputs, ...speaker,
    exaggeration: Number(data.exaggeration ?? 0.5),
    max_new_tokens: 256
  });
  const audio = waveform.data;
  const buffer = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
  self.postMessage({ type: "audio", data: buffer }, [buffer]);
}

self.addEventListener("message", async event => {
  const { type, data } = event.data || {};
  try {
    if (type === "load") await load();
    else if (type === "encode") await encodeSpeaker(data);
    else if (type === "generate") await generate(data);
    else throw new Error("Unknown worker action: " + type);
  } catch (error) {
    self.postMessage({ type: "failure", data: { message: error?.message || String(error) } });
  }
});
