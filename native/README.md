# Native Windows RVC Voice Changer

This folder builds a native Windows RVC voice changer. The build uses VoiceLala/rvc-cpp as the actual inference engine and ONNX Runtime for model execution. The resulting `voicechanger.dll` is a native Windows DLL; `voicechanger_host.exe` captures the microphone and plays converted audio to the selected output device.

## Important: reference WAV

An arbitrary `reference.wav` is not itself an RVC inference model. Your repo's existing RVC instructions use the WAV as training data and then produce an inference-ready voice model. The native runtime therefore loads the resulting `.onnx` voice model plus ContentVec and RMVPE support models.

For the current repo recipe, use an RVC v2 voice model trained at 40 kHz with 768-dimensional features.

## Build

Install Visual Studio 2022 with Desktop C++ tools and CMake, then run:

```text
build_windows.bat
```

The script downloads ONNX Runtime 1.24.5 and CMake fetches the native rvc-cpp engine.

## Run

```text
run_voicechanger.bat <voice.onnx> <contentvec.onnx> <rmvpe.onnx> [input_id] [output_id]
```

Omit device IDs to use the Windows mapper. Run `build\Release\voicechanger_host.exe` without arguments to list microphone/output device IDs.

The host uses a fixed 100 ms conversion block and caps the input queue at three blocks so buffering cannot grow indefinitely.
