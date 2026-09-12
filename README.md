# VoiceChanger Desktop

Windows desktop STT/TTS VoiceChanger built around Pocket TTS voice cloning.

### What it does

- 🎤 Records a short microphone sample or imports an audio file.
- 🧬 Clones that voice locally with Pocket TTS.
- 🗣️ Uses Windows/Electron speech recognition for STT.
- 🔊 Generates the recognized speech in the cloned voice.
- 🎚️ Lets you select any Windows audio output device, including VoiceMeeter Input or VB-Cable.
- 📦 Builds as a portable Windows `.exe` — no Vercel, GitHub Pages, or separate server to run.
- 💾 Pocket TTS assets are cached after the first download.

### Build

GitHub Actions automatically builds the portable Windows EXE on pushes to `main` or by manually running **Build Windows VoiceChanger**.

The first launch needs internet access to download the Pocket TTS runtime/model assets. After that, the model is cached locally when the runtime allows caching.

### Audio routing

For Voicemeeter, select **VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)** as the app's Output Device. For VB-Cable, select **CABLE Input (VB-Audio Virtual Cable)**. Windows/Voicemeeter can then route that signal wherever you need it.
