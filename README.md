# VoiceChanger — Python + OpenVoice V2

This repo now uses a real backend voice-cloning pipeline:

**Browser microphone → FastAPI/WebSocket → SpeechRecognition → OpenVoice V2 → generated WAV → browser playback**

The repository's Ava WAV is used as the OpenVoice reference voice.

## Important

GitHub Pages can host the `index.html`, but it cannot run `server.py`. The Python backend must run on a Python-capable host or locally. Enter that backend's URL in the page before pressing **Start VoiceChanger**.

## Backend setup

OpenVoice's official V2 instructions use Python 3.9 and require the OpenVoice V2 checkpoints plus MeloTTS. See the official OpenVoice documentation for the checkpoint downloads and setup.

Install the dependencies from `requirements.txt`, then make sure these model files/directories exist:

```text
checkpoints_v2/
  converter/
    config.json
    checkpoint.pth
  base_speakers/
    ses/
      en-newest.pth
```

Then start the backend:

```bash
uvicorn server:app --host 0.0.0.0 --port 8000
```

Health check:

```text
http://localhost:8000/health
```

## Frontend

For GitHub Pages, open the deployed page and set **Python backend URL** to your public HTTPS backend URL, for example `https://your-backend.example.com`.

The browser uses a WebSocket (`wss://`) when the backend URL is HTTPS.

## Voice cloning

OpenVoice V2 performs tone-color cloning from the reference WAV. It is not simply replaying the WAV. The backend first creates source speech with MeloTTS and then converts its tone color using the reference speaker embedding.

## Current STT behavior

The backend receives approximately two seconds of PCM audio at a time and sends each chunk through `SpeechRecognition`. This keeps the UI responsive while keeping the implementation simple. For lower latency later, the STT layer can be replaced with a streaming recognizer such as Vosk or Whisper.
