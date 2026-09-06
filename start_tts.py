from __future__ import annotations

"""Automatic launcher for VoiceChanger's local PyTorch TTS server.

Run this file with Python. It installs everything listed in requirements.txt,
then starts python_tts_server.py. No BAT file is required.
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REQUIREMENTS = ROOT / "requirements.txt"
SERVER = ROOT / "python_tts_server.py"


def install_dependencies() -> None:
    print("Checking VoiceChanger TTS dependencies...")
    subprocess.check_call([
        sys.executable, "-m", "pip", "install", "--upgrade", "pip",
    ])
    subprocess.check_call([
        sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS),
    ])


def main() -> None:
    if not REQUIREMENTS.is_file():
        raise SystemExit(f"Missing requirements.txt: {REQUIREMENTS}")
    if not SERVER.is_file():
        raise SystemExit(f"Missing TTS server: {SERVER}")

    install_dependencies()

    print("\nAll TTS dependencies are installed.")
    print("Starting the PyTorch WAV -> Whisper -> XTTS-v2 server...\n")
    raise SystemExit(subprocess.call([sys.executable, str(SERVER)]))


if __name__ == "__main__":
    main()
