# Flux Continuous Voice

Simple browser voice pipeline:

**Microphone → Deepgram Flux STT → Deepgram Aura-2 Amalthea TTS → Chrome audio → Voicemeeter/VRChat**

## What this build does

- Keeps the microphone and Flux STT WebSocket connected continuously.
- Sends raw 16 kHz PCM to Deepgram Flux over `/v2/listen`.
- Uses Flux's turn detection instead of repeatedly stopping/restarting recognition.
- Keeps one persistent TTS WebSocket for the conversation.
- Sends each completed transcript as a TTS turn.
- Plays raw 24 kHz PCM as a scheduled audio queue to reduce gaps and chopped endings.
- Sends Flux KeepAlive messages during silence.

## Important voice detail

Deepgram's **Amalthea** voice is **Aura-2**, model `aura-2-amalthea-en`, with a Filipino English accent. Amalthea is not currently part of the Flux TTS voice catalog.

Therefore this version intentionally uses:

- **Flux STT:** `flux-general-en`
- **Amalthea TTS:** `aura-2-amalthea-en`

That is the combination that matches the requested continuous Flux listening plus Filipino Amalthea output.

## Run it

1. Open `index.html` from a local web server or GitHub Pages.
2. Paste a Deepgram API key or short-lived token into the page.
3. Click **Start listening**.
4. Allow microphone access.
5. Speak normally.
6. Route Chrome audio to Voicemeeter if you want the generated voice sent into VRChat.

The key is entered at runtime and is not stored in this repository.

## Browser authentication

Browsers cannot set an arbitrary Authorization header on a WebSocket constructor, so the app uses Deepgram's documented `Sec-WebSocket-Protocol` authentication form: `token, YOUR_KEY`.

For public production deployments, use short-lived Deepgram tokens from a backend instead of exposing a long-lived API key to the browser.
