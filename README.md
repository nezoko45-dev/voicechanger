# 🎙️ VoiceChanger

A standalone browser voice changer using Cartesia STT and Sonic TTS. There is no MelonLoader DLL, C# bridge, Python runtime, or desktop audio process.

## Pipeline

**🎤 Microphone → Cartesia STT → 📝 text → Cartesia Sonic TTS → 🔊 browser output → VB-CABLE → ChilloutVR**

## Run it

The app is in `web/` and is configured for Netlify with `netlify.toml`.

Serve the `web` folder from a static HTTPS host such as Netlify, Vercel, or GitHub Pages. Microphone access requires a secure browser context (HTTPS, or localhost during local development).

Enter your Cartesia API key and Cartesia Voice ID in the page. The page requests a short-lived Cartesia access token and keeps it in browser memory.

## ChilloutVR audio routing

1. Set the browser TTS output to **CABLE Input**.
2. In ChilloutVR, choose **CABLE Output** as the microphone/input device.
3. Click **Connect**.
4. Click **Test voice**.
5. Click **Start automatic mode** and speak normally.

The browser detects pauses, sends each captured sentence to Cartesia STT, sends the resulting text to Cartesia Sonic TTS, then plays the returned WAV through the selected output.

## Cartesia

The browser uses Cartesia API version `2026-03-01`, `ink-whisper` for STT, and `sonic-3.5` for TTS.

Never commit an API key to the repository. For a public deployment, remember that browser-side credentials are exposed to the user running the page; use short-lived access tokens and rotate your API key if it is ever exposed.
