# Native ONNX Runtime VoiceChanger

Native C++17 Windows x64 WAV voice conversion.

The executable uses the official ONNX Runtime Windows x64 SDK (headers, import library, and onnxruntime.dll) plus the MIT-licensed RVC.cpp inference library.

The app opens one WAV file, converts it to the bundled target voice, and writes <input>_voicechanged.wav beside the input.

Runtime files:
- VoiceChanger.exe
- dvc.dll
- onnxruntime.dll

Bundled model files:
- GuraTalkV2.onnx
- vec-768-layer-12.onnx
- rmvpe.onnx
