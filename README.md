# Deepgram Continuous STT/TTS Voice App

Simple browser-only pipeline:

headset mic → Deepgram STT WebSocket → Deepgram TTS WebSocket → Chrome audio → Voicemeeter → VRChat

## How it works

- The microphone stays open continuously.
- Browser audio is downsampled to 16 kHz PCM and streamed continuously to Deepgram's `/v1/listen` WebSocket.
- Interim STT results appear immediately.
- When Deepgram marks a completed speech segment, that transcript is sent to one persistent Deepgram `/v1/speak` WebSocket.
- TTS audio is played as raw 48 kHz PCM chunks as they arrive instead of waiting for a complete audio file.
- KeepAlive messages keep the STT connection alive during silence.

Deepgram documents `interim_results=true` for ongoing transcription updates and the `speech_final` result for finalized speech segments. citeturn0search7

Deepgram's TTS WebSocket supports continuous text input with `Speak` and `Flush` messages and streams audio back over the same connection. citeturn0search5turn0search0

## Setup

1. Open the app.
2. Paste a Deepgram API key or temporary token.
3. Leave the TTS voice as `aura-2-asteria-en` or enter another Aura voice.
4. Click Start listening.
5. Route Chrome's output through Voicemeeter if you want VRChat to receive it.

For browser WebSockets, Deepgram supports authentication through the `Sec-WebSocket-Protocol` mechanism because browsers cannot set arbitrary Authorization headers on WebSocket connections. citeturn0search3

## Important

This is an STT → TTS echo/voice app, not an audio-to-audio voice clone. Deepgram STT turns your microphone into text, and Deepgram TTS generates the response voice from that text.