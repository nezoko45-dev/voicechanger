# SpeechStack-style WAV Clone Voice Changer

This is a clean local architecture based on the real-time SpeechStack pattern: streaming STT + exact transcript pass-through + streaming/custom TTS. SpeechStack itself is a recipe/library, so this project keeps the provider interfaces configurable instead of pretending SpeechStack supplies a voice-cloning API.

## Pipeline

`Microphone -> streaming STT -> exact transcript filter -> WAV-clone TTS -> selected output -> VB-CABLE -> VRChat`

There is intentionally **no LLM** in the loop. Your words are not rewritten, summarized, or answered by an AI agent.

## Setup

1. Install Node.js 20+.
2. Open a terminal in this folder.
3. Copy `.env.example` to `.env`.
4. Set your STT WebSocket/API details and your WAV-cloning TTS endpoint.
5. Put your reference WAV in `voices/reference.wav`.
6. Run `start.bat` or `node server.mjs`.
7. Open `http://localhost:8787` in Chrome.

## VB-CABLE

For VRChat:

- Browser TTS output: **CABLE Input**
- VRChat microphone: **CABLE Output**

The UI exposes both device selectors and has buttons to select the VB-CABLE devices automatically.

## Important

SpeechStack does not itself provide one universal custom-WAV-cloning endpoint. The TTS adapter is therefore isolated in `server.mjs`. Plug in the cloning service/model you actually want rather than silently falling back to a catalog voice.
