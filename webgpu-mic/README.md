# VoiceClonNX microphone converter

## Run without installing Python (recommended)

A Windows one-file EXE build workflow is included.

1. Open the repository's [Actions page](https://github.com/nezoko45-dev/voicechanger/actions/workflows/build-voiceclonnx-exe.yml).
2. Open the latest **Build VoiceClonNX Windows EXE** run on the feature branch.
3. Wait for the build to finish, then download the **VoiceClonNX-Windows** artifact.
4. Extract the ZIP and double-click **VoiceClonNX.exe**.
5. The app opens its local browser UI at `http://127.0.0.1:8765`. Choose a microphone, record, choose your reference WAV, and convert.
6. Keep the EXE console window open while using the app.

The executable bundles the Python runtime and app dependencies, so end users do **not** need Python installed. The first conversion still needs internet access to download the selected engine's model weights. Model files are not embedded in the EXE, so the initial download can be large.

If no successful Actions build artifact is available yet, the workflow may still be building or may have failed; do not assume the EXE has been produced until the artifact appears.

## Build yourself (optional)

`build_exe_locally.bat` builds the EXE on Windows, but building locally requires Python. This is only for developers; end users should use the prebuilt artifact.

## Included files

- `index.html`: browser UI with microphone selection, PCM WAV recording, reference WAV selection, engine selection, conversion, playback and download.
- `server.py`: local FastAPI backend, also serves the browser UI so the user only launches one app.
- `requirements.txt`: conversion and packaging dependencies.
- `build_exe_locally.bat`: optional local PyInstaller build.
- `start_voiceclonnx.bat`, `start_backend.bat`, `start_ui.bat`: source-checkout developer launchers.
- `model-probe.html`: experimental ONNX Runtime WebGPU session-compatibility probe.

## WebGPU status

**The complete converter does not yet run in WebGPU.** The EXE bundles and runs the local VoiceClonNX runtime; the browser checks WebGPU availability and the model probe tests session creation for an individual ONNX file. A successful session is not proof of end-to-end conversion. Browser-side WebGPU support still requires an engine pipeline to be ported and validated.

The API binds to loopback (`127.0.0.1`) only. Do not expose it to the public internet. Use voice samples you own or are authorized to use.
