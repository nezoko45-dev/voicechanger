---
title: VoiceChanger OpenVoice V2
emoji: 🎙️
colorFrom: purple
colorTo: pink
sdk: gradio
sdk_version: 6.26.0
app_file: app.py
python_version: 3.10
license: mit
---

# 🎙️ VoiceChanger — OpenVoice V2

This version is refit for **Hugging Face Spaces + Gradio**.

### Pipeline

**Microphone → Gradio streaming audio → SpeechRecognition → OpenVoice V2 → Ava voice clone → audio playback**

The repository's Ava WAV is used as the reference voice. The OpenVoice V2 checkpoint is pulled automatically from the public `myshell-ai/OpenVoiceV2` model repository when the Space starts.

## Hugging Face setup

1. Create a new **Gradio Space** on Hugging Face.
2. Use the files from this repository, especially `app.py`, `requirements.txt`, and the Ava WAV.
3. Select **ZeroGPU** if it is available for your account/Space.
4. Hugging Face will install the dependencies and start `app.py` automatically.

The Space does **not** need a separate FastAPI server or a `localhost:8000` backend URL. Gradio handles the microphone UI and app connection directly.

## Important hosting note

Hugging Face currently allows free personal accounts in good standing to host up to two Gradio Spaces on ZeroGPU; ordinary Gradio/Docker compute Spaces require a paid plan. Availability of ZeroGPU can depend on the account and Space eligibility.

OpenVoice V2 is a large model, so the first startup can take a while while its checkpoint is downloaded.

## Local run

```bash
pip install -r requirements.txt
python app.py
```

Then open the local Gradio URL shown in the terminal.

## Voice cloning

OpenVoice V2 first generates neutral English speech with MeloTTS, then applies the tone color extracted from the Ava reference WAV. It is not simply replaying the reference WAV.

## Credits

- OpenVoice V2: MyShell / OpenVoice
- Speech recognition: SpeechRecognition + Google recognition service
- UI/runtime: Gradio + Hugging Face Spaces
