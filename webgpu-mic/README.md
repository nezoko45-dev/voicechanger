# VoiceClonNX microphone converter (experimental)

This folder now contains a complete **local microphone → reference WAV → converted WAV** workflow, plus a WebGPU compatibility probe.

## Windows quick start

1. Install **Python 3.10 or newer** and make sure the Python launcher (`py`) is available.
2. Open this folder in the repository checkout.
3. Double-click `start_voiceclonnx.bat`. It opens a local backend window and a local UI window.
4. In Chrome, choose your microphone, record a short clip, select your reference WAV, and click **Convert recording**.
5. The first backend launch installs the Python packages. The first conversion downloads the selected engine's ONNX model files from Hugging Face and can take a while.

If you want to start the parts separately, use `start_backend.bat` and `start_ui.bat`.

## Included files

- `index.html`: microphone selection, recording, PCM WAV encoding, reference WAV selection, engine selection, conversion request, playback, and download.
- `server.py`: local FastAPI bridge on `127.0.0.1:8765`. It accepts a single reference WAV or two reference clips.
- `requirements.txt`: backend dependencies, including `voiceclonnx`.
- `start_voiceclonnx.bat`: one-click launcher for both windows.
- `start_backend.bat`: creates a local virtual environment, installs requirements, and runs the backend.
- `start_ui.bat`: serves the page on `http://127.0.0.1:8000`.
- `model-probe.html`: experimental ONNX Runtime WebGPU session-compatibility probe for one local ONNX model at a time.

## WebGPU status — important

**Actual voice conversion currently runs in the local Python VoiceClonNX backend, not in browser WebGPU.** The page checks whether the browser exposes WebGPU, and `model-probe.html` tests whether ONNX Runtime Web can create a session for a selected model. Neither is an end-to-end WebGPU conversion yet.

VoiceClonNX engines are multi-stage pipelines with preprocessing and potentially multiple ONNX models. A WebGPU port requires validating all required models, operators, tensor shapes, preprocessing, and output parity. See the upstream [VoiceClonNX README](https://github.com/TigreGotico/voiceclonnx) for engine and runtime details. citeturn763989search0turn763989search1

## Troubleshooting

- **Backend unavailable:** leave the backend command window open and check that `http://127.0.0.1:8765/health` returns JSON.
- **Microphone permission:** open the page at `http://127.0.0.1:8000`, not as a `file://` URL.
- **First conversion takes a long time:** the selected engine's model files may need to download. Keep the backend window open.
- **Package installation fails:** confirm Python 3.10+ is installed and internet access is available for initial package/model downloads.
- **Model probe:** serve this folder on localhost, open `model-probe.html`, and choose a compatible `.onnx` file. A successful session creation alone does not prove that inference or the full voice-conversion pipeline works.

The local API binds to loopback only. Do not expose port 8765 to the public internet. Use only voice references you own or have permission to use.
