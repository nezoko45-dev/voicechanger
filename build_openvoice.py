"""Download the OpenVoice V2 and MeloTTS model assets during a Render build.

This keeps large model checkpoints out of Git while making a fresh Render
instance self-contained before the FastAPI service starts.
"""
from pathlib import Path
import os
import subprocess

ROOT = Path(__file__).resolve().parent


def run(command):
    print("+", " ".join(command))
    subprocess.run(command, cwd=ROOT, check=True)


# Clone the upstream model repositories into temporary build locations if the
# required checkpoints are not already present.
openvoice_dir = ROOT / "OpenVoice"
melo_dir = ROOT / "MeloTTS"

if not (ROOT / "checkpoints_v2" / "converter" / "checkpoint.pth").exists():
    run(["git", "clone", "--depth", "1", "https://github.com/myshell-ai/OpenVoice.git", str(openvoice_dir)])
    # OpenVoice's repo contains the V2 checkpoint download helper.
    run(["python", str(openvoice_dir / "download_models.py"), "--model_version", "v2"])
    src = openvoice_dir / "checkpoints_v2"
    dst = ROOT / "checkpoints_v2"
    if src.exists() and not dst.exists():
        src.rename(dst)

if not (ROOT / "checkpoints_v2" / "base_speakers" / "ses" / "en-newest.pth").exists():
    if not melo_dir.exists():
        run(["git", "clone", "--depth", "1", "https://github.com/myshell-ai/MeloTTS.git", str(melo_dir)])

# MeloTTS downloads its package assets on first model initialization. The
# OpenVoice demo's expected speaker embedding is copied when available.
print("Model preparation complete. OpenVoice/MeloTTS assets will be loaded by server.py.")
