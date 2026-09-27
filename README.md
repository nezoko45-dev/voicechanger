# Rust RVC Voice Changer

A simple **native Windows Rust voice changer** for VRChat.

## Audio path

Microphone
→ Rust/WASAPI
→ realtime RVC
→ selected Windows output / Voicemeeter
→ VRChat

There is no Chrome audio path, Electron audio path, Deepgram, Hugging Face agent, or Python runtime in the app.

## What is included

- Native Rust desktop UI
- Windows WASAPI device enumeration
- Microphone selection
- Output selection, including Voicemeeter devices
- ONNX RVC inference through the Rust `vc-rs` engine
- ContentVec + RMVPE support
- Bounded realtime queues
- Separate inference worker so model loading/inference does not block the audio callback
- Live pitch/input/output controls
- 40–300 ms chunk control

## First run

1. Install Rust/Cargo on Windows.
2. Run `run_rust.bat`.
3. The first build downloads Rust dependencies and the ONNX Runtime CPU package.
4. Put your models in `models\\` or use Browse:
   - `voice.onnx` — your RVC voice model
   - `content_vec_500.onnx` — ContentVec
   - `rmvpe.onnx` — RMVPE
5. Select your microphone.
6. Select your Voicemeeter input/output route.
7. Press **START**.
8. In VRChat, choose the Voicemeeter virtual microphone that receives the converted signal.

## Notes

The app currently uses the CPU ONNX backend for the simplest portable Rust build. The engine can be switched to Windows ML/DirectML later without changing the audio architecture.

The RVC engine is based on the Rust `vc-rs` project:
https://github.com/shirohata/vc-rs

The vc-rs project and its downloaded models retain their own licenses.

## Why this should behave better

The browser/Tone.js approach was an effects processor, not a true RVC engine. This version keeps audio capture, buffering, inference, and playback in one native Windows process. The realtime engine uses bounded queues, so a slow inference worker cannot create an endlessly growing delay queue.
