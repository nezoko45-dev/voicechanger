const ort = require('onnxruntime-node');
const fs = require('fs');
const path = require('path');

async function main() {
  const model = process.argv[2];
  if (!model) {
    console.error('Usage: node node_onnx_smoke_test.js path\\to\\model.onnx');
    process.exit(2);
  }
  const p = path.resolve(model);
  if (!fs.existsSync(p)) throw new Error(`Model not found: ${p}`);
  console.log(`Loading ONNX model: ${p}`);
  const session = await ort.InferenceSession.create(p, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all'
  });
  console.log('ONNX Runtime Node loaded successfully.');
  console.log('Inputs:', session.inputNames.join(', '));
  console.log('Outputs:', session.outputNames.join(', '));
}
main().catch(err => { console.error(err.stack || err); process.exit(1); });
