import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.join(here, "..", "src", "main.js");
let source = fs.readFileSync(mainPath, "utf8");

// Use the model repository maintained alongside pocket-tts-js. The old build
// pointed at a different ONNX export and also pinned an old ORT CDN path.
source = source.replace(
  /const MODEL_SOURCES = \[[\s\S]*?\];/,
  'const MODEL_SOURCES = [\n  "https://huggingface.co/vlapky/pocket-tts-onnx/resolve/main/onnx"\n];'
);
source = source.replace(/cacheName: "voicechanger-pocket-tts-v3"/, 'cacheName: "voicechanger-pocket-tts-v4"');
source = source.replace(/\n\s*modelBaseUrl: source,/, "");
source = source.replace(/\n\s*ortBaseUrl: "https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@1\.20\.0\/dist\/",/, "");

fs.writeFileSync(mainPath, source);
console.log("Pocket TTS build fix applied: official vlapky model source, fresh cache, package defaults for ORT.");
