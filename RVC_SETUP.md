# Local RVC voice changer

This repo now includes a Python RVC backend. Unlike the browser-only Deepgram version, RVC performs acoustic voice conversion, so the goal is to keep your speech and convert the timbre to a trained female voice.

## 1. Install Python

RVC Python currently recommends Python 3.10 for its packaged runtime. A CUDA-capable NVIDIA GPU is strongly recommended for interactive use.

```powershell
py -3.10 -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements-rvc.txt
```

For NVIDIA/CUDA, install the PyTorch build appropriate for your GPU after installing the RVC package. See the RVC Python package documentation for the matching Torch command.

## 2. Add an RVC voice model

You need a trained RVC `.pth` model. Put it somewhere local, for example:

```text
voicechanger/
  models/
    female.pth
```

An optional `.index` file can be used by RVC for improved conversion quality, depending on the model/runtime.

Do not commit private voice models or large model files to GitHub unless you intentionally want them public.

## 3. Start the RVC server

PowerShell:

```powershell
$env:RVC_MODEL="models/female.pth"
$env:RVC_DEVICE="cuda:0"
python rvc_server.py
```

CPU fallback:

```powershell
$env:RVC_MODEL="models/female.pth"
$env:RVC_DEVICE="cpu"
python rvc_server.py
```

The WebSocket server listens on:

```text
ws://127.0.0.1:8765
```

## 4. Important latency note

The first RVC implementation intentionally uses short audio chunks over a WebSocket. RVC inference is substantially heavier than Deepgram TTS, and very tiny chunks can sound rough or produce boundary artifacts. The next client integration should therefore use a small rolling buffer (roughly 0.5–1.0 seconds) with overlap/crossfading rather than sending every microphone callback directly to RVC.

The upstream RVC project reports real-time implementations around 170 ms end-to-end under suitable hardware, with lower latency possible using ASIO and appropriate hardware. Actual latency depends heavily on the GPU/CPU, model, pitch extractor, buffer size, and audio device.

## 5. Security

The server binds to `127.0.0.1` by default so it is only reachable from the local computer. Do not expose the RVC WebSocket publicly without adding authentication and TLS.
