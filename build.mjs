import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, "dist");
const excludedDirs = new Set([".git", "node_modules", "dist", ".venv", "voiceclonnx_helper"]);
const excludedFiles = new Set(["package.json", "package-lock.json", "build.mjs", "README.md", "requirements.txt"]);
async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirs.has(entry.name)) continue;
    if (entry.isFile() && excludedFiles.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(src, dst);
    else if (entry.isFile()) await cp(src, dst);
  }
}
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await copyTree(root, out);

// Ship the exact ONNX Runtime Web glue/WASM files alongside the extension.
// MV3 extension pages cannot safely import executable runtime modules from a CDN.
const ortDist = path.join(root, "node_modules", "onnxruntime-web", "dist");
const ortOut = path.join(out, "ort");
await mkdir(ortOut, { recursive: true });
for (const name of await readdir(ortDist)) {
  if (/^ort-wasm-simd-threaded(?:\.[a-z0-9-]+)?\.(?:mjs|wasm)$/.test(name)) {
    await cp(path.join(ortDist, name), path.join(ortOut, name));
  }
}

await build({
  entryPoints: [path.join(root, "voice-clone.js")],
  outfile: path.join(out, "voice-clone.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["chrome116"],
  sourcemap: false,
  legalComments: "none",
  logLevel: "info"
});
console.log("Built unpacked extension into ./dist with a local ONNX Runtime Web runtime.");
