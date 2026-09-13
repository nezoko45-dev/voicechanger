import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = [
  path.join(here, "..", "src", "main-fixed.js"),
  path.join(here, "..", "src", "main-output.js")
];
const modelSource = 'const MODEL_SOURCES = [\n  "https://huggingface.co/vlapky/pocket-tts-onnx/resolve/main/onnx"\n];';

for (const file of files) {
  let source = fs.readFileSync(file, "utf8");
  source = source.replace(/const MODEL_SOURCES = \[[\s\S]*?\];/, modelSource);
  source = source.replace(/,\s*ortBaseUrl:\s*"https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@[^\"]+\/dist\/"/g, "");
  source = source.replace(/,\s*ortBaseUrl:\s*[^,}]+/g, "");
  fs.writeFileSync(file, source);
}
console.log("Browser Pocket TTS fix applied: same vlapky ONNX export and package-managed browser runtime.");
