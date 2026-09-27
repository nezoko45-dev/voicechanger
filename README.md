# WAV Reference Voice Changer

This version is built for having only a WAV recording of the target voice.

It does not require classic RVC voice.onnx + ContentVec + RMVPE model files.

## Architecture

Microphone
-> Seed-VC zero-shot realtime conversion
-> Windows output / Voicemeeter
-> VRChat

The Rust program is the native launcher and simple UI. Seed-VC supplies the neural zero-shot conversion runtime.

Seed-VC supports zero-shot realtime voice conversion from a 1-30 second reference recording without training a separate voice model. Its realtime engine uses worker-thread buffering and device selection for live use.

## Setup

1. Install Rust.
2. Install Python 3.10 or newer.
3. Make sure Git is installed.
4. Run setup_seedvc.bat.
5. Choose your WAV reference recording.
6. Press START.
7. In the Seed-VC window, select your microphone and Voicemeeter output.
8. In VRChat, select the Voicemeeter virtual microphone receiving the converted signal.

The Seed-VC model checkpoints are downloaded automatically by its runtime. You do not manually find voice.onnx, content_vec_500.onnx, or rmvpe.onnx.

## Reference WAV

Use a clean 1-30 second sample of the target speaker. Speech is preferable to music/noise.

## Realtime

Zero-shot neural voice conversion is much heavier than a pitch/effects processor. A GPU is strongly recommended for realtime use. Seed-VC publishes realtime measurements in the hundreds of milliseconds depending on hardware and settings.

## Important

The Rust launcher itself does not perform the neural inference. A pure-Rust implementation of this zero-shot model would require porting a large PyTorch model stack. Using Seed-VC Realtime keeps the UI native/simple while using the actual WAV-reference zero-shot converter.

Seed-VC Realtime:
https://github.com/jiaheguo521/seed-vc-realtime
