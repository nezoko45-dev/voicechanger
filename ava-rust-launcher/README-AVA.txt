AVA RUST VOICE CHANGER — WINDOWS PORTABLE PACKAGE

Extract the complete vc-rs Windows ML GUI + CLI release ZIP into this folder. Keep every release DLL beside vc-gui.exe and vc-rs.exe. No Python or Rust installation is required.

LIVE MICROPHONE CONVERSION
1. Run start-ava.bat.
2. Complete setup, select a compatible RVC voice model and audio devices, then press Start.
3. Route output through Voicemeeter or a virtual audio cable for VRChat.

OFFLINE WAV / MP3 CONVERSION
1. Run convert-audio.bat.
2. Select your RVC voice model and a WAV or MP3 speech recording.
3. Choose where to save the converted WAV.
4. The helper invokes the bundled vc-rs.exe wav CLI and opens the output location.
5. MP3 is decoded to a temporary WAV using portable FFmpeg. Your original audio is not changed.

MODEL REQUIREMENTS
- The CLI requires an ONNX RVC voice model. If you select a .pth checkpoint, the helper opens vc-gui.exe. In the GUI, select the supported RVC v2/F0 PTH under RVC model and let the built-in converter create an ONNX file beside it. Then run convert-audio.bat again and select the new ONNX.
- Unsupported PTH types (such as RVC v1) need a separate RVC conversion tool.
- ContentVec (content_vec_500.onnx) and RMVPE (rmvpe.onnx) support models are required. The helper uses .\assets\content_vec_500.onnx and .\assets\rmvpe.onnx when present; otherwise it asks you to browse to them.
- This is offline file conversion. It does not perform live microphone conversion.

INTEL GRAPHICS
Use the Windows ML package. It can use available DirectML/Windows ML providers and CPU fallback. OpenVINO is experimental and hardware-dependent.

REQUIRED WINDOWS COMPONENT
Windows ML requires Microsoft Windows App SDK Runtime 2.1 or later:
https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/downloads

UPSTREAM
vc-rs: https://github.com/shirohata/vc-rs
CLI reference: https://github.com/shirohata/vc-rs/blob/main/docs/cli.md
No voice models are bundled. Review upstream and model licenses before use.
