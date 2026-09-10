# 🎙️ VoiceChanger

A standalone browser-based voice changer using **Cartesia STT** and **Cartesia Sonic TTS**.

## Pipeline

**🎤 Microphone → Cartesia STT → 📝 transcript → Cartesia Sonic TTS → 🔊 browser output → VB-CABLE → ChilloutVR**

## What this version uses

- Cartesia API key
- Cartesia Voice ID for the voice you want to use
- Cartesia `ink-whisper` for speech-to-text
- Cartesia `sonic-3.5` for text-to-speech
- Browser microphone/audio APIs
- VB-CABLE for routing the generated voice into ChilloutVR

## What it does NOT use

- ❌ Deepgram
- ❌ MelonLoader DLL
- ❌ C# bridge
- ❌ Python runtime
- ❌ Netlify/Vercel backend

The app is a static HTML/CSS/JavaScript browser app. Your Cartesia key is kept in the browser page and is never written into the repository.

## ChilloutVR routing

1. In the browser app, use **CABLE Input** as the TTS output.
2. In ChilloutVR, select **CABLE Output** as the microphone/input device.
3. Connect the Cartesia API key and Voice ID.
4. Start automatic mode and speak normally.

The browser detects speech, sends each spoken phrase to Cartesia STT, then sends the transcript to Cartesia TTS and plays the generated WAV through the selected output device.
