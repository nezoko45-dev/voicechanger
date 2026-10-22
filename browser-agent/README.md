# Local Voice Agent

A browser-first voice conversation prototype. It has a live call interface, local speech-to-text, a local language model, microphone capture, and optional zero-shot voice cloning.

## Use it

Host the `browser-agent/` folder on an HTTPS static host (GitHub Pages works), then open it in current desktop Chrome. Grant microphone permission. Press **Start session** and wait for model loading. To talk, press **Start talking**, speak, then press **Finish speaking**. To enable voice cloning, choose a clean 5–15 second English sample of your own voice, confirm consent, and load the voice model.

No API key, paid inference service, or app backend is used. The model downloads from public CDNs/model hosting on first use and is cached by the browser. Model files may be large; voice cloning can require around 1.5 GB plus substantial RAM/VRAM. GPU compatibility and performance vary by device.

## Included
- Interactive call-style interface and conversation history.
- Browser-side text generation via Transformers.js and Qwen2.5 0.5B Instruct.
- Browser-side transcription via Whisper tiny English model; microphone audio is decoded/resampled in the browser.
- Optional zero-shot English voice cloning and TTS via VoxShot + Chatterbox ONNX.
- Explicit voice-ownership/permission confirmation.

## Known limits
- This is a prototype, not yet production hardened. The first load may be slow and model CDN/runtime compatibility can change.
- Push-to-talk is implemented; continuous voice activity detection, automatic end-of-turn detection, and barge-in are not implemented yet.
- Cloned speech is generated after the LLM response, so response latency can be noticeable.
- VoxShot's public API is still pre-1.0 and the Chatterbox engine is English-focused. Browsers without a capable GPU may be very slow or fail due to memory limits.
- The app's JavaScript and CSS are statically hosted, but it is not a static mockup: interactions and inference happen at runtime in the browser. A zero-backend design still needs a hosted frontend and public model downloads; it cannot avoid downloading model weights.

## Privacy
Microphone recordings are handled in the page and passed to the local ASR model; voice reference audio is passed to the local TTS engine. Model weights are downloaded from public hosting. No audio/text inference API is configured. Only clone a voice you own or have explicit permission to use.
