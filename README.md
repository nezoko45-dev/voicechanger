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

This repository is now primarily set up for **Google Colab + Gradio**, with the app also runnable locally.

### Pipeline

**Microphone → Gradio streaming audio → SpeechRecognition → OpenVoice V2 → Ava voice clone → audio playback**

The repository's Ava WAV is used as the reference voice. The OpenVoice V2 checkpoint is pulled automatically from the public `myshell-ai/OpenVoiceV2` model repository when the app starts.

## 🚀 Google Colab

The easiest way to run the GPU version is the included **`VoiceChanger_Colab.ipynb`** notebook.

1. Open `VoiceChanger_Colab.ipynb` in Google Colab.
2. In Colab, choose **Runtime → Change runtime type → GPU** if a GPU is available.
3. Run the cells from top to bottom.
4. The final cell launches Gradio and prints a temporary public URL.
5. Open that URL and allow microphone access.

Colab provides free access to computing resources including GPUs, but availability and runtime limits vary. citehttps://research.google.com/colaboratory/faq.html

> **Important:** Colab runtimes are temporary. If the runtime shuts down, the temporary Gradio URL disappears and the model must be loaded again in a new session.

## Local run

```bash
pip install -r requirements.txt
python app.py
```

Then open the Gradio URL shown in the terminal.

## Hugging Face

The repository was previously prepared for Hugging Face Spaces, but ordinary Gradio compute there may require paid hardware. The Colab notebook is the recommended no-card route for GPU testing.

## Voice cloning

OpenVoice V2 first generates neutral English speech with MeloTTS, then applies the tone color extracted from the Ava reference WAV. It is not simply replaying the reference WAV.

## Credits

- OpenVoice V2: MyShell / OpenVoice
- Speech recognition: SpeechRecognition + Google recognition service
- UI/runtime: Gradio + Google Colab or local Python
