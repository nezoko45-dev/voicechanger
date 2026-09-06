---
title: VoiceChanger — Deepgram + Fish Audio
emoji: 🎙️
colorFrom: purple
colorTo: pink
sdk: gradio
sdk_version: 6.26.0
app_file: app.py
python_version: 3.10
license: mit
---

# 🎙️ VoiceChanger — Deepgram + Fish Audio

VoiceChanger now uses a lightweight cloud voice pipeline:

**🎤 Microphone → Deepgram STT → Fish Audio TTS → 🔊 Voice**

The previous FreeVC/local-model pipeline has been removed in favor of Deepgram for speech recognition and Fish Audio for speech synthesis.

## How it works

1. The user records speech with the Gradio microphone.
2. The audio is sent to Deepgram's `/listen` API using the normal `DEEPGRAM_API_KEY` environment variable.
3. The returned transcript is sent to Fish Audio's `/tts` API.
4. Fish Audio returns synthesized MP3 audio.
5. Gradio plays the generated voice automatically.

## Environment variables

Set these in your hosting provider's environment-variable settings. **Do not put API keys in GitHub.**

```text
DEEPGRAM_API_KEY=your_deepgram_api_key
FISH_API_KEY=your_fish_api_key
FISH_REFERENCE_ID=optional_fish_voice_reference_id
FISH_MODEL=s2.1-pro-free
DEEPGRAM_MODEL=nova-3
```

`FISH_REFERENCE_ID` is optional. Set it when you want Fish Audio to synthesize using a specific voice/reference. `FISH_MODEL` can be changed if your Fish Audio account uses another model.

## Automatic dependencies

`app.py` checks for its required Python packages and installs missing packages automatically. `requirements.txt` is also provided for hosts that install dependencies before launching the app.

## Run locally

```bash
pip install -r requirements.txt
python app.py
```

Then open the Gradio URL printed by the app.

## Notes

This version intentionally uses the standard Deepgram API key through an environment variable rather than embedding a credential in the source code. Deepgram authenticates API requests with `Authorization: Token <API_KEY>`. Fish Audio uses `Authorization: Bearer <API_KEY>` for its TTS API.

The current UI uses a push-to-process flow rather than attempting to synthesize every tiny microphone buffer independently. This avoids flooding either API with requests and produces cleaner transcript-to-TTS turns.

## Credits

- Deepgram — speech recognition
- Fish Audio — text-to-speech
- Gradio — UI/runtime
