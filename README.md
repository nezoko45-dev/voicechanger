# ElevenLabs Scribe + PocketTTS Voice Changer

This app uses **ElevenLabs Scribe Realtime** for live speech-to-text and **PocketTTS** for the cloned voice output.

Pipeline:

**Microphone → ElevenLabs Scribe Realtime STT → PocketTTS voice clone → selected output**

The browser requests a short-lived ElevenLabs realtime Scribe token and then connects to Scribe over WebSocket. PocketTTS remains local in the browser and uses `Recording (10).wav` as the reference voice.

## Run

Open the GitHub Pages app, enter an ElevenLabs API key, choose the microphone and output, then press **START VOICE CHANGER**.

For a production/public deployment, token creation should be moved to a server so the permanent ElevenLabs API key is never exposed to the browser.

## PocketTTS

PocketTTS is loaded from the repository's `pocket-tts/` implementation and uses the ONNX model hosted on Hugging Face.

Reference voice:

`Recording (10).wav`

For VRChat, route the selected browser output through Voicemeeter or a virtual cable and choose the matching virtual microphone in VRChat.
