# Browser WebGPU Voice Changer

A browser-only voice changer for the `voicechanger` repo.

Pipeline:

`default headset mic → AudioWorklet → RVC v2 browser runtime → Chrome/Voicemeeter output`

There is **no Python, Electron, OpenVoice, Deepgram STT, or Deepgram TTS** in this version.

The app uses RVC-Web-Runtime 1.0.5 with ONNX Runtime Web. ContentVec and RMVPE are requested on WebGPU; the RVC synthesis model currently runs on WASM because the runtime documents a WebGPU kernel limitation for that model.

Required files:
- RVC v2 `.onnx` target voice model
- ContentVec `.onnx`
- RMVPE `.onnx`

Chrome 113+ with WebGPU/hardware acceleration is required. The microphone remains open continuously; audio is processed in 2.5-second chunks to keep inference manageable.

For Voicemeeter, set Chrome's playback/output device to the Voicemeeter input you want to feed into VRChat. The browser itself does not need to know anything about VRChat.

RVC-Web-Runtime documents browser inference, its model requirements, and its current WebGPU/WASM backend split.
