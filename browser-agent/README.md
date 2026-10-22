# Local Voice Agent (prototype)

A static browser app prototype in the `browser-agent/` folder. It does not require an API key or a server-side inference backend.

## Run it

Because browser ES modules and model assets need an HTTP origin, publish this folder as a static site (for example, GitHub Pages or a free static host), or run any local static file server during development. No package install is required to use a published version.

1. Open `index.html` on the hosted HTTPS site in a current Chrome or Edge browser.
2. Select **Start session**.
3. Wait for the first model download to finish.
4. Send a message in the conversation box.

## Current scope

- Responsive call-style UI.
- Local text conversation using Transformers.js and the Qwen2.5 0.5B Instruct ONNX model.
- Uses WebGPU when available and falls back to WASM.
- No API key or paid inference endpoint.

## Not implemented yet

- Microphone capture with fully local speech recognition.
- Zero-shot voice-clone inference and streaming speech output.
- Interrupt/barge-in handling and hands-free turn detection.

The browser's built-in speech recognition is intentionally not presented as private/local because implementations may send audio to a browser-vendor service. The browser's built-in speech synthesis is also not voice cloning. Those will be replaced by a documented local inference path before calling this a complete voice agent.

## Privacy and model downloads

Model files are fetched from Hugging Face on first use and may be cached by the browser. Conversation generation is performed in the browser after the model loads. A first-run internet connection is required. Browser/GPU memory limits and model support vary by device.

## License notes

Check the model card and runtime/model licenses before redistributing a public deployment. Clone only a voice you own or have permission to use.
