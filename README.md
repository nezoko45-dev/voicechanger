# 🎙️ VoiceChanger

A static browser-based VoiceChanger using Deepgram Flux for real-time speech recognition and Deepgram Aura for speech output.

## Pipeline

**🎤 Microphone → Deepgram Flux WebSocket → 📝 transcript → 🔊 Deepgram Aura TTS**

## Frontend

The app is a single static `index.html` and can be hosted on GitHub Pages, Netlify, Vercel, or another static host.

Enter your Deepgram API key in the app. The current frontend stores it in the browser's local storage so the app can connect directly to Deepgram.

> For a public production deployment, do not expose a permanent API key in browser code. Use a backend/worker that issues temporary credentials instead.

## Deepgram Flux

The frontend uses Deepgram's current Flux `/v2/listen` WebSocket endpoint with `flux-general-en`, 16 kHz `linear16` audio, Flux turn detection, and periodic keep-alive messages.

## TTS

Deepgram Aura TTS is requested through the Deepgram `/v1/speak` endpoint and played directly in the browser. The selected voice and output sample rate can be changed from the UI.

## Troubleshooting

The diagnostics panel reports WebSocket connection state, Flux errors, TTS errors, and close codes. If the microphone does not start, make sure the site is served over HTTPS and that microphone permission is allowed.
