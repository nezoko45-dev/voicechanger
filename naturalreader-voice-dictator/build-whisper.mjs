import { build } from "esbuild";
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

await build({
  entryPoints: ["whisper-worker.js"],
  outfile: "whisper-worker.bundle.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  minify: true,
  sourcemap: false,
  loader: { ".wasm": "file" },
  assetNames: "assets/[name]-[hash]"
});

// Package ONNX Runtime's WASM binaries and its dynamically imported module loaders.
// The .mjs files are required at runtime (for example ort-wasm-simd-threaded.jsep.mjs).
const source = "node_modules/onnxruntime-web/dist";
if (existsSync(source)) {
  await mkdir("assets", { recursive: true });
  for (const file of await readdir(source)) {
    if (file.endsWith(".wasm") || file.endsWith(".mjs") || file.endsWith(".js")) {
      await cp(`${source}/${file}`, `assets/${file}`);
    }
  }
}
console.log("Built whisper-worker.bundle.js and packaged ONNX Runtime JS/WASM assets.");
