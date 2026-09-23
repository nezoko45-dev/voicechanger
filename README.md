# Seed-VC Real-Time Voice Changer

Simple speech-to-speech voice cloning for Windows.

**Microphone → Seed-VC real-time voice conversion → Voicemeeter / VRChat**

## Included

- `index.html` — simple reference-voice helper.
- `start.bat` — one-click setup and launch.
- `requirements-seedvc.txt` — dependencies.
- `clone_input/` — reference voice folder.
- `models/` — model storage folder.
- `output/` — output folder.

The complete Seed-VC real-time source is downloaded automatically into `seed-vc/` on first run. The launcher checks the GUI, realtime engine, audio modules, and config so an incomplete installation is repaired.

## First run

1. Install **Python 3.10**.
2. Double-click `start.bat`.
3. Wait for the numbered setup steps.
4. Put your target/reference WAV in `clone_input\reference.wav`.
5. Seed-VC opens its real-time GUI.
6. Select that WAV as **reference audio**.
7. Select your microphone as **Input Device**.
8. Select **Voicemeeter Input** or your virtual cable as **Output Device**.
9. Click **Start Voice Conversion**.

This is **speech-to-speech voice conversion**. There is no STT, LLM, or TTS.

## If setup looks stuck

The first run can take several minutes while Python packages and the Seed-VC model are downloaded. The launcher now reports Python setup, source download, dependency installation, and launch.

If Seed-VC is incomplete, run `start.bat` again; it will repair the missing source files.

## VRChat

Route Seed-VC's output into your Voicemeeter virtual microphone path, then select that virtual microphone in VRChat.

No Electron audio pipeline is required.