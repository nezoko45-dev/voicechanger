# Python WAV -> Speech Synthesis

This adds a local neural speech pipeline to the voicechanger repo:

**WAV file -> Faster-Whisper STT -> XTTS-v2 -> synthesized WAV**

The uploaded WAV is used as the speaker reference, so XTTS regenerates the transcript instead of simply replaying the original recording. This is speech synthesis/voice cloning, not a browser pitch-shifter.

## Windows

1. Install Python 3.10 or 3.11.
2. Run `START_PYTHON_TTS.bat`.
3. The first launch downloads the Whisper and XTTS-v2 models.
4. The server runs at `http://127.0.0.1:8787`.

## API

`POST /synthesize` with multipart field `wav` containing a WAV file.

The response is a synthesized WAV. The `X-Transcript` response header contains the detected transcript.

`GET /health` checks whether the service is reachable.

## GPU

An NVIDIA CUDA GPU is strongly recommended for XTTS. To force CPU mode, start with:

```powershell
$env:PYTHON_TTS_DEVICE="cpu"
$env:PYTHON_TTS_COMPUTE_TYPE="int8"
python python_tts_server.py
```

The first run can be slow because the neural models have to download and load.

## Voice reference

For the best result, use a clean WAV containing one speaker, little background noise, and several seconds of natural speech. Only use voice recordings you have permission to use.
