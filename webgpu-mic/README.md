# VoiceClonNX Mic + WebGPU experiment

This experimental page adds microphone recording and a single reference-WAV picker on top of the existing local VoiceClonNX API.

## Run
1. Start the existing VoiceClonNX local backend from the `girl-voice` extension project (it must listen on `127.0.0.1:8765`).
2. Serve this folder from localhost (microphone access requires a secure context such as localhost) or open it in a browser that grants microphone access.
3. Choose a microphone, record a short clip, select your reference WAV, and click Convert.

## Important implementation notes
- The existing VoiceClonNX API accepts a source file plus two reference WAVs. This page duplicates the chosen reference file into both reference slots to remain compatible with that API.
- Browser microphone recording commonly produces WebM/Opus rather than WAV. The existing backend must be able to decode that input; if it rejects WebM, add server-side decoding (for example via FFmpeg) or record/export WAV in the browser before conversion.
- The page checks and reports WebGPU support, but does **not** run VoiceClonNX in WebGPU. The existing VoiceClonNX Python/ONNX backend performs the conversion. A true browser WebGPU conversion requires compatible ONNX models, a browser ONNX Runtime WebGPU build, and validation of every model operator; this branch does not yet supply those model assets or guarantee that compatibility.
- Use reference voices you own or are authorized to use. Audio is sent only to the local backend by this page; the backend may download model weights from its configured model host.
