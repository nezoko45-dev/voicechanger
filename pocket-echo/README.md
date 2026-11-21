# Pocket Echo for Windows

Pocket Echo listens to the Windows default microphone, transcribes each recognized phrase, then speaks it using a voice cloned locally by GPT-SoVITS.

## Features
- Local speech recognition through the Windows English speech recognizer (SAPI).
- Reference audio: WAV, MP3, FLAC, OGG, M4A, AAC, WMA, AIFF, OPUS, WEBM, and MP4.
- Reference transcript field: provide the words spoken in the reference clip for zero-shot voice prompting.
- GPT-SoVITS v2Pro Windows package is downloaded from ModelScope on first setup and extracted into the user's LocalAppData folder.
- Download progress bar displays percentage and downloaded/total size when the server reports a content length; extraction and model initialization show an indeterminate progress animation.
- Generates speech locally and plays it through the selected Windows output device.
- No Hugging Face login, cloud TTS API, or separately installed Python required. The GPT-SoVITS archive includes its own Python runtime and model files.

## Build
GitHub Actions builds a self-contained Windows x64 app and bundles FFmpeg plus the standalone 7-Zip extractor. Download the `PocketEcho-windows-x64.zip` artifact from the Actions run.

## First use
1. Extract the ZIP to a folder and run `PocketEcho.exe`.
2. Choose a WAV/MP3 (or another supported audio format) reference recording.
3. Enter the exact transcript of the spoken words in that recording. Use the words from the first 30 seconds because the app normalizes the first 30 seconds of audio.
4. Click **Prepare cloned voice**. On first use, Pocket Echo downloads the GPT-SoVITS v2Pro Windows package from ModelScope; the progress bar shows download progress, then extraction and model loading.
5. Select headphones, speakers, or a Voicemeeter output.
6. Click **Start listening**. Each finalized microphone phrase is synthesized with the reference voice and played, then listening resumes.

The speech recognizer uses the Windows default microphone and requires an installed English speech recognition component. GPT-SoVITS uses the bundled local runtime and GPU-capable package; the first-time ModelScope download is large and requires an internet connection. The extracted engine and models are reused on later launches.

Only clone voices you own or have permission to use. Pocket Echo is intended for consensual personal voice use.
