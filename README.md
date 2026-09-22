# Deepgram → OpenVoice V2

Chrome mic → Deepgram /v1/listen WebSocket → Deepgram /v1/speak WebSocket → local OpenVoice V2 tone conversion → Chrome playback.

Run by double-clicking start.bat, then open http://127.0.0.1:8765.

Required official OpenVoice V2 files:
- checkpoints_v2/converter/config.json
- checkpoints_v2/converter/checkpoint.pth
- checkpoints_v2/base_speakers/ses/en-us.pth

Use a clean 3–10 second mono WAV reference.

The browser uses Deepgram's documented WebSocket subprotocol authentication. For public hosting, use a short-lived Deepgram token instead of a permanent API key.

No Electron and no browser ONNX runtime are used.
