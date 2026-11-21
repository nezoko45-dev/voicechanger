# Pocket Echo for Windows

Pocket Echo listens to the Windows default microphone, transcribes each recognized phrase, then speaks it using a voice cloned from your own reference recording with Kyutai Pocket TTS.

## Features
- Local speech recognition through the Windows English speech recognizer (SAPI).
- Reference audio: WAV, MP3, FLAC, OGG, and M4A.
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

The speech recognizer uses the Windows default microphone and requires an installed English speech recognition component. Pocket TTS runs locally on the CPU. The first model download may take time and requires an internet connection; later runs use the local model cache.

Only clone voices you own or have permission to use. Pocket Echo is intended for consensual personal voice use.
