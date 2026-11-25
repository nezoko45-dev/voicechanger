SEED-VC WAV / MP3 REFERENCE VOICE CONVERTER
===========================================

This replaces the old .pth-only RVC workflow with Seed-VC Realtime.
The GUI accepts reference audio formats including WAV and MP3. The reference
recording is used as the target voice; your microphone is the live source.

INSTALL
1. Extract this folder somewhere writable.
2. Make sure the drive containing this folder has at least 6 GB free.
3. Double-click setup.bat and let it finish.
4. Double-click start-voice-converter.bat.
5. In "Load reference audio", choose your WAV or MP3 voice sample.
6. Select your actual microphone under Input Device.
7. Select Voicemeeter Input / a virtual cable under Output Device.
8. Start conversion in the GUI, then choose the matching virtual microphone
   in VRChat.

NO MANUAL PYTHON INSTALL
The setup script downloads a private Python 3.10 runtime manager and creates
a local environment inside this folder. Python is used internally by Seed-VC,
but you do not have to install or configure Python yourself.

IMPORTANT INTEL UHD 730 LIMITATION
This package installs CPU-only PyTorch because Intel UHD graphics does not
provide NVIDIA CUDA. Seed-VC Realtime strongly recommends an NVIDIA CUDA GPU.
CPU conversion may be very slow, may add substantial delay, or may not keep
up with live microphone audio. This package is a functional reference-audio
setup, not a promise of smooth real-time performance on Intel UHD 730.

FIRST RUN
The first launch downloads model weights from the model host and needs an
internet connection. Keep the reference sample clean, with 1-30 seconds of
clear speech and little background music/noise.

TROUBLESHOOTING
- If model download fails, retry after checking internet access.
- If Windows blocks the scripts, use the file Properties > Unblock option
  where available, then run setup.bat again.
- If audio is choppy, try a larger Block Time and lower Diffusion Steps.
- Use Voicemeeter or a virtual audio cable to route the converted output.

DISK SPACE NOTE
CPU PyTorch is a large download. Keep at least 6 GB free on the drive where
this folder is located before running setup. The installer checks this first
and avoids keeping duplicate package-cache copies. If setup previously failed
because the disk was full, free space before retrying; do not delete the .venv
folder unless you want to reinstall the environment from scratch.
