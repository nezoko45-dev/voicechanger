# ONNX RVC Voice Changer

This repo now uses a **native Windows RVC voice changer**, not the old browser/Resemble/Deepgram experiments.

## Start

Double-click:

`VoiceChanger.bat`

The launcher downloads the current Windows x64 `vc-rs` GUI package once and then launches:

`vc-gui.exe`

The application is a native Windows RVC voice changer written in Rust and uses ONNX models through Windows ML/ONNX Runtime. It does not require Python or Electron. citeturn2view0

## Models

The GUI needs:

1. Your RVC voice model (`.onnx`; supported RVC v2/F0 `.pth` files can be converted by the GUI)
2. ContentVec
3. RMVPE

The upstream application downloads the support models and stores them locally for reuse. citeturn2view0

## Audio

Set the microphone input and output to your Windows/Voicemeeter devices inside the GUI. The application performs realtime conversion in worker threads rather than waiting inside the audio callback. citeturn2view0

### Important

The Windows ML build requires the Windows App SDK Runtime. If you want the ONNX/TensorRT package with the inference runtime bundled, that package targets NVIDIA GPUs and requires an up-to-date NVIDIA driver. citeturn2view0
