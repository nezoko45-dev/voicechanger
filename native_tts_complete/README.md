# Native Mic -> Whisper -> TTS -> Output

This is the native Windows build for the requested voice app.

Pipeline:

`WASAPI mic -> Whisper DLL -> text -> TTS DLL -> WAV/PCM -> WASAPI output`

The build intentionally keeps model weights outside the source tree. `setup_models.bat` downloads a Whisper GGML model and a Piper ONNX voice model. Whisper.cpp supports Windows/MSVC, a C-style API, CPU inference, and VAD. See https://github.com/ggml-org/whisper.cpp.

## Important

The Piper voice is a local catalog voice, not WAV voice cloning. The host includes a reference-WAV slot/API so a real cloning backend can be dropped in later without changing the audio pipeline. A WAV file cannot by itself become a cloning model; the TTS model must support speaker conditioning.

## Build

1. Install Visual Studio 2022 with Desktop C++ and CMake.
2. Run `setup_models.bat` once while online.
3. Run `build.bat`.
4. Run `run.bat`.

No Python is required.
