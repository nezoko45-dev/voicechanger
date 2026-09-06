from __future__ import annotations

"""One-command launcher for VoiceChanger's local PyTorch TTS server.

Run this file with Python. It automatically installs missing Python packages,
then starts python_tts_server.py. No BAT file is required.
"""

import importlib.util
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REQUIREMENTS = ROOT / "requirements-tts.txt"
SERVER = ROOT / "python_tts_server.py"


def install_dependencies() -> None:
    print("Checking VoiceChanger TTS dependencies...")
    subprocess.check_call([
        sys.executable,
        "-m",
        "pip",
        "install",
        "--upgrade",
        "pip",
    ])
    subprocess.check_call([
        sys.executable,
        "-m",
        "pip",
        "install",
        "-r",
        str(REQUIREMENTS),
    ])


def main() -> None:
    if not SERVER.exists():
        raise SystemExit(f"Missing TTS server: {SERVER}")
    if not REQUIREMENTS.exists():
        raise SystemExit(f"Missing requirements file: {REQUIREMENTS}")

    install_dependencies()

    print("\nAll TTS dependencies are installed.")
    print("Starting the PyTorch WAV -> Whisper -> XTTS-v2 server...\n")
    subprocess.call([sys.executable, str(SERVER)])


if __name__ == "__main__":
    main()
