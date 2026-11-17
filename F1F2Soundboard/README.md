# F1 / F2 Soundboard

A small Windows soundboard with two independent sound slots.

## Use
1. Run `F1F2Soundboard.exe`.
2. Choose a separate audio file for the F1 and F2 slots.
3. Select the Windows audio output device.
4. Press F1 or F2 anywhere to play that slot through the selected output.

Each slot can play independently, so F1 and F2 can overlap. Pressing the same key again restarts that slot's sound. The app uses direct Windows audio output through NAudio; it does not connect to the voicechanger endpoint.

Supported formats depend on Windows codecs and include WAV, MP3, FLAC, WMA, AAC, M4A, AIFF and OGG/Opus where decoders are available.

## Build
The GitHub Actions workflow builds a self-contained Windows x64 EXE. Download the `F1F2Soundboard-win-x64` artifact from the latest successful **Build F1F2 Soundboard EXE** workflow run. No separate .NET installation is required.