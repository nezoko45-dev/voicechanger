# Browser VoiceChanger

This version runs voice cloning and TTS in the browser using Pocket TTS ONNX/Web Worker inference.

## No Python / no batch file

The app does not need a local Python server, `.bat` launcher, Vercel function, or voice API key.

The browser downloads the quantized model from Hugging Face and caches it locally. The model performs inference on the client. Pocket TTS's browser implementation supports cloning a voice from an audio clip and streaming generated audio. The first model download is large; later visits reuse the browser cache.

## Development

From `web/`:

```bash
npm install
npm run dev
```

Then open the Vite URL and click **Load Browser Model**.

## Production build

```bash
npm run build
```

The generated `dist/` folder is static and can be hosted on a normal static host. No server-side inference is required.

## VoiceChanger

The TTS side is local browser inference. The live VoiceChanger uses the browser's `SpeechRecognition`/`webkitSpeechRecognition` when available, then feeds recognized phrases into the locally cloned Pocket TTS voice. Speech recognition support varies by browser.
