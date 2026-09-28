# Local PocketTTS Echo

This app listens to the selected microphone, transcribes each spoken sentence with a **local sherpa-onnx Whisper model**, then sends that text to **PocketTTS**. PocketTTS uses `Recording (10).wav` as the reference voice and the generated audio is played through the selected output.

Pipeline:

**Microphone → local Whisper STT → PocketTTS voice clone → output**

No Deepgram or cloud speech API is used by the app.

## Models

PocketTTS:

`models/sherpa-onnx-pocket-tts-int8-2026-01-26/`

Required:
- lm_flow.int8.onnx
- lm_main.int8.onnx
- encoder.onnx
- decoder.int8.onnx
- text_conditioner.onnx
- vocab.json
- token_scores.json

Local STT:

`models/sherpa-onnx-whisper-tiny.en/`

Required:
- tiny.en-encoder.int8.onnx
- tiny.en-decoder.int8.onnx
- tiny.en-tokens.txt

The official sherpa-onnx documentation provides the Whisper tiny.en ONNX model and shows the encoder/decoder/token configuration used for offline recognition. citeturn1search0turn1search1

## Run

Install the local `sherpa-onnx-node` dependency once, then:

`node server.js`

Open:

`http://127.0.0.1:8787/`

The Node addon is the recommended sherpa-onnx JavaScript path and supports local native ASR/TTS. citeturn0search5turn0search1

## How echo works

Press **START LISTENING**, speak a sentence, then pause briefly. The browser sends raw microphone samples to the local Node server. Whisper transcribes them locally. PocketTTS then generates the sentence using `Recording (10).wav`, and the browser plays the resulting WAV.

This is sentence-based speech-to-speech, not waveform-to-waveform conversion. PocketTTS itself is a TTS voice-cloning model that accepts text plus reference audio. citeturn0search7
