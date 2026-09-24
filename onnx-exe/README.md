# VoiceChanger ONNX EXE

Windows desktop real-time RVC voice changer using ONNX Runtime.

Pipeline: Mic -> HuBERT/ContentVec ONNX -> FCPE ONNX -> RVC ONNX -> output device / Voicemeeter.

The build packages Python and the runtime with PyInstaller, so the finished Windows package does not require a separate Python installation.

Bundled default models:
- GuraTalkV2.onnx
- vec-768-layer-12.onnx
- fcpe.onnx

The GitHub Actions build produces VoiceChanger-ONNX-Windows.zip containing VoiceChanger-ONNX.exe, its runtime/model files, and Run-VoiceChanger.bat.
