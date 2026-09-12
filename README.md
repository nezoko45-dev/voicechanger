# VoiceChanger

Windows desktop AI VoiceChanger.

- 🎤 Speech-to-text from your microphone
- 🧬 Local Pocket TTS voice cloning from a reference recording
- 🗣️ Cloned voice text-to-speech
- 🔊 Windows audio-device routing for Voicemeeter / VB-Cable
- 📦 Portable Windows EXE

The desktop build downloads Pocket TTS model weights on first launch and caches them locally. Model downloads use multiple sources so a temporary Hugging Face 429 does not immediately break startup.

Voice cloning should only be used with voices you have permission to use.
