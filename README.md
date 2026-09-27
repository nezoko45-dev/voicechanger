# PocketTTS Local Voice App

A deliberately simple local PocketTTS app.

## What it does

- Uses `Recording (10).wav` as the local reference voice.
- Lets you choose/test a microphone.
- Lets you choose an audio output.
- Enter text.
- PocketTTS generates speech using the reference voice.
- Audio stays on the computer.

PocketTTS is a zero-shot TTS voice-cloning model: it takes text plus a short reference recording and generates speech in that voice. It is **not** direct waveform-to-waveform live voice conversion. citeturn0search1

## Run

Install the local `sherpa-onnx-node` dependency once, then run:

`node server.js`

Open:

`http://127.0.0.1:8787/`

No batch file is required.

## Offline

After Node, the npm dependency, and the PocketTTS model are already present on the computer, the app itself makes no cloud speech requests.

Required PocketTTS files:

- lm_flow.int8.onnx
- lm_main.int8.onnx
- encoder.onnx
- decoder.int8.onnx
- text_conditioner.onnx
- vocab.json
- token_scores.json

The official sherpa-onnx PocketTTS documentation lists these model components and supports reference-audio voice cloning. citeturn0search1
