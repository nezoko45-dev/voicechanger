# VoiceChanger

Browser-only AI voice cloning and TTS app.

- 🧠 Pocket TTS ONNX inference in the browser
- 📁 Clone a voice from a WAV reference
- 🔊 Streaming cloned-voice TTS
- 🎤 Browser VoiceChanger mode using SpeechRecognition when available
- 💾 Model assets cached by the browser
- ❌ No Python
- ❌ No batch file
- ❌ No Vercel backend
- ❌ No voice-cloning API key

## Run

The browser app is in `web/`.

```bash
cd web
npm install
npm run dev
```

For deployment, run `npm run build` in `web/` and host the resulting `web/dist/` folder on a static host.

The first model load downloads the quantized Pocket TTS browser assets. They are cached locally afterward.
