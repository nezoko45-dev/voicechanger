import { ChatterboxModel, AutoProcessor, Tensor } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0-next.2';

const MODEL_ID = 'onnx-community/chatterbox-ONNX';
let model = null;
let processor = null;
const speakers = new Map();

self.onmessage = async (event) => {
  const { type, data = {} } = event.data || {};
  try {
    if (type === 'load') {
      self.postMessage({ type: 'progress', data: { status: 'Loading text processor…' } });
      processor = await AutoProcessor.from_pretrained(MODEL_ID);
      self.postMessage({ type: 'progress', data: { status: 'Loading Chatterbox ONNX model (WASM CPU)…' } });
      model = await ChatterboxModel.from_pretrained(MODEL_ID, {
        device: 'wasm',
        dtype: {
          embed_tokens: 'fp32',
          speech_encoder: 'fp32',
          language_model: 'q4',
          conditional_decoder: 'fp32',
        },
        progress_callback: (progress) => self.postMessage({ type: 'progress', data: progress }),
      });
      self.postMessage({ type: 'load:complete', data: { device: 'wasm' } });
      return;
    }
    if (type === 'encode_speaker') {
      if (!model) throw new Error('Load the Chatterbox model first.');
      const samples = new Float32Array(data.audioData);
      const tensor = new Tensor('float32', samples, [1, samples.length]);
      const embedding = await model.encode_speech(tensor);
      speakers.set(data.id, embedding);
      self.postMessage({ type: 'encode_speaker:complete', data: { id: data.id } });
      return;
    }
    if (type === 'generate') {
      if (!model || !processor) throw new Error('Chatterbox is not loaded.');
      const embedding = speakers.get(data.speakerId);
      if (!embedding) throw new Error('Upload or record a reference voice sample first.');
      const inputs = await processor._call(data.text);
      const waveform = await model.generate({
        ...inputs,
        ...embedding,
        exaggeration: Number(data.exaggeration ?? 0.5),
        max_new_tokens: 256,
      });
      const values = waveform.data;
      const buffer = values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength);
      self.postMessage({ type: 'generate:complete', data: { waveform: buffer, sampleRate: 24000 } }, [buffer]);
      return;
    }
    throw new Error('Unknown worker request: ' + type);
  } catch (error) {
    self.postMessage({ type: 'error', data: { message: error?.message || String(error) } });
  }
};
