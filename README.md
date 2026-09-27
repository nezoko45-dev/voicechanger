# Local RVC Voice Changer

This repository now uses a **local RVC voice-conversion architecture** instead of Tone.js effects or a cloud speech agent.

## Audio path

```
Microphone
   ↓
Local RVC
   ↓
Voicemeeter / virtual audio cable
   ↓
VRChat microphone
```

The recommended local engine is **vc-rs**, a native Windows RVC implementation. It supports real-time microphone conversion and does not require a Python/PyTorch environment. It can use Windows ML/DirectML on supported hardware or TensorRT on compatible NVIDIA GPUs.

## Setup

1. Run `setup_rvc.bat`.
2. Download the **Windows ML** vc-rs package from the official releases page.
3. Extract the package into the repository's `RVC` folder.
4. Make sure `RVC\vc-gui.exe` exists.
5. Run `start_rvc.bat`.
6. Select your microphone and output device inside RVC.
7. Select your RVC voice model.
8. Route the RVC output to Voicemeeter.
9. Select the matching Voicemeeter virtual microphone in VRChat.

For an NVIDIA GPU, the TensorRT package is also available and can provide a faster native GPU path.

## Models

The RVC engine needs a compatible RVC voice model. vc-rs supports ONNX RVC models and can convert supported RVC v2/F0 `.pth` models through its GUI.

The repository intentionally does **not** store large model files.

## Why this version

The old browser Tone.js version only changed pitch/EQ/compression. RVC performs neural voice conversion, so your speech timing and delivery are retained while the vocal characteristics are converted.

There is no Deepgram API usage and no cloud speech-to-speech service in this architecture.

## Important

Chrome cannot launch a local EXE directly. The HTML page is therefore a lightweight information/control page, while `start_rvc.bat` launches the native audio engine.

## Upstream

vc-rs:
https://github.com/shirohata/vc-rs

Its own license and third-party model licenses apply to the downloaded engine and models.
