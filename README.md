# 🎙️ VoiceChanger

A clean browser-only Deepgram VoiceChanger.

## Pipeline

**🎤 Microphone → Deepgram Flux STT → 📝 live transcript → 🔊 Deepgram Flux TTS**

## Setup

1. Open the app over HTTPS.
2. Open **Deepgram API key**.
3. Paste a Deepgram API key and choose **Save for this session**.
4. Press **Start** and allow microphone access.

The key is stored only in browser `sessionStorage`; the input field is cleared after saving.

## Important

This repository intentionally has no Python app, Netlify function, OpenRouter integration, Fish Audio integration, or build step. The app is a single static `index.html`.

## Troubleshooting

The app shows the WebSocket close code, close reason, connection lifetime, and audio sample-rate conversion in its diagnostics area. A normal user stop is code `1000`; an unexpected browser/network/API termination is shown explicitly so it can be diagnosed instead of hidden behind an endless reconnect loop.
