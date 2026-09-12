import { defineConfig } from "vite";

// Keep live voice conversion from speaking partial/interim word chunks.
// The source file is transformed at build time so the runtime waits for
// Deepgram's final utterance before sending text to Pocket TTS.
function sentenceBufferPlugin() {
  return {
    name: "sentence-buffer-voice-conversion",
    enforce: "post",
    transform(code, id) {
      if (!id.endsWith("/src/main-fixed.js")) return null;
      const old = `  const words = conversionBuffer.split(/\\s+/).filter(Boolean);\n  // Small chunks give low latency without constantly restarting the TTS engine.\n  if (words.length >= 3 || final) {\n    const count = final ? words.length : Math.min(4, words.length);\n    const chunk = words.splice(0, count).join(" ");\n    conversionBuffer = words.join(" ");\n    if (chunk) {\n      conversionQueue.push(chunk);\n      void drainConversionQueue();\n    }\n  } else if (words.length) {\n    conversionTimer = setTimeout(() => {\n      conversionTimer = null;\n      const pending = conversionBuffer.split(/\\s+/).filter(Boolean);\n      if (!pending.length) return;\n      const count = Math.min(3, pending.length);\n      const chunk = pending.splice(0, count).join(" ");\n      conversionBuffer = pending.join(" ");\n      if (chunk) { conversionQueue.push(chunk); void drainConversionQueue(); }\n    }, 140);\n  }`;
      const replacement = `  const words = conversionBuffer.split(/\\s+/).filter(Boolean);\n  // Do not flush interim words. Keep the complete utterance together so\n  // Pocket TTS never starts speaking in the middle of a sentence.\n  if (final && words.length) {\n    const chunk = words.join(" ");\n    conversionBuffer = "";\n    conversionQueue.push(chunk);\n    void drainConversionQueue();\n  }`;
      if (!code.includes(old)) throw new Error("Sentence-buffer patch target was not found in main-fixed.js");
      return { code: code.replace(old, replacement), map: null };
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [sentenceBufferPlugin()],
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
