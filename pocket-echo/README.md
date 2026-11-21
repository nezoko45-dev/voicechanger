# Pocket Echo for Windows

Pocket Echo listens to the Windows default microphone, transcribes each recognized phrase, then speaks it using a voice cloned from your own reference recording with Kyutai Pocket TTS.

## Features
- Local speech recognition through the Windows English speech recognizer (SAPI).
- Reference audio: WAV, MP3, FLAC, OGG, M4A, AAC, WMA, AIFF, OPUS, WEBM, and MP4 (converted to normalized mono WAV before voice export).
- Prepares a reusable Pocket TTS voice profile from the recording.
- Generates speech locally and plays it through the selected Windows output device.
- No Python installation or cloud API required.

## Build
The GitHub Actions workflow builds a self-contained Windows x64 app and bundles the official Pocket TTS Windows binary. Download the `PocketEcho-windows-x64.zip` artifact from the Actions run or the GitHub release.

## Use
1. Extract the ZIP to a folder.
2. Run `PocketEcho.exe`.
3. Choose your own voice recording and click **Prepare cloned voice**.
4. Select headphones, speakers, or a Voicemeeter output.
5. Click **Start listening**. Each finalized phrase is synthesized and played, then listening resumes.

The speech recognizer uses the Windows default microphone and requires an installed English speech recognition component. Pocket TTS runs locally on the CPU. The bundled FFmpeg converter normalizes reference recordings to 24 kHz mono WAV; Pocket TTS uses the first 30 seconds for voice conditioning. The first model download may take time and requires an internet connection; later runs use the local model cache. **Important:** Kyutai's official voice-cloning weights are gated on Hugging Face. Before first use, sign in at https://huggingface.co/kyutai/pocket-tts and accept/request model access if prompted. Then create a read token at https://huggingface.co/settings/tokens and set it in Windows (Command Prompt): `setx HF_TOKEN "hf_your_token_here"`. Close and reopen Pocket Echo after setting the token. Keep it private. If the download is denied, Pocket Echo now shows these steps and the underlying error.

Only clone voices you own or have permission to use. Pocket Echo is intended for consensual personal voice use.
