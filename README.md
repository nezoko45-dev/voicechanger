---
title: VoiceChanger — Direct FreeVC
emoji: 🎙️
colorFrom: purple
colorTo: pink
sdk: gradio
sdk_version: 6.26.0
app_file: app.py
python_version: 3.10
license: mit
---

# 🎙️ VoiceChanger — Direct Voice Conversion

VoiceChanger now uses a **text-free voice-conversion pipeline**:

**🎤 Microphone → FreeVC → 🔊 Converted voice**

The old SpeechRecognition, MeloTTS, and OpenVoice text-generation pipeline has been removed. FreeVC performs one-shot voice conversion directly from source speech toward a reference speaker. The upstream FreeVC project describes it as text-free one-shot voice conversion and provides pretrained checkpoints. citeturn1search0turn3search2

## How it works

1. The browser streams microphone audio into Gradio.
2. Audio is resampled to 16 kHz when necessary.
3. WavLM extracts content features from the spoken audio.
4. FreeVC converts those features using the selected reference voice embedding.
5. The converted audio is streamed back to the browser.

The repository's Ava WAV is selected as the default reference voice. You can replace it with another clean reference recording in the UI.

## First startup

The app automatically downloads the required FreeVC source files and pretrained checkpoint from the public `OlaWod/FreeVC` Hugging Face Space. The WavLM content model is loaded from `microsoft/wavlm-large`. The FreeVC checkpoint is about 473 MB, so the first startup can take a while. citeturn3search0turn3search6

A GPU is strongly recommended for live conversion.

## Run locally

```bash
pip install -r requirements.txt
python app.py
```

Then open the Gradio URL printed by the app.

## Important

This is direct **voice conversion**, not speech-to-text followed by text-to-speech. It therefore preserves the source speaker's words, timing, and delivery much more directly than the previous architecture.

Real-time latency depends heavily on the available GPU/CPU. For comparison, established RVC real-time voice-changing software reports end-to-end latency around 170 ms under suitable hardware, but latency varies by model and hardware. citeturn0search1

## Credits

- FreeVC: OlaWod / FreeVC
- WavLM: Microsoft
- UI/runtime: Gradio
