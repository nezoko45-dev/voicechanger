# OpenVoice V2 Mic Voice Changer

This is a **local microphone → speech-to-speech voice conversion** test using the pure-ONNX `voiceclonnx` OpenVoice V2 engine. It is not STT/TTS: your microphone audio is converted directly to the target/reference voice.

## Run

1. Install Python 3.11+ on Windows.
2. Double-click `start_openvoice.bat`.
3. Open `http://127.0.0.1:8765` in Chrome.
4. Pick a clean reference WAV.
5. Click **Refresh devices** and select your microphone/output.
6. Click **START**.

The ONNX engine is downloaded on first use by `voiceclonnx`; PyTorch is not required for inference. The OpenVoice V2 engine runs at 22.05 kHz internally. The browser sends 16 kHz PCM chunks and the runtime handles the audio conversion path.

## VRChat

Set the browser output to your VB-CABLE playback device, then select the corresponding VB-CABLE recording device as your VRChat microphone.

## Latency

The first prototype uses 1.5-second chunks to keep buffering bounded. OpenVoice V2 is not designed as a sample-by-sample streaming converter, so this is a functional real-time test rather than a guaranteed ultra-low-latency solution.

OpenVoice V2's official implementation is a tone-color conversion system; the pure-ONNX `voiceclonnx` implementation provides an inference-only route without PyTorch at runtime.