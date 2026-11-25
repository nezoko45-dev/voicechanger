"""Prepare the bundled FFmpeg executable for librosa/audioread on Windows."""
from pathlib import Path
import shutil
import sys

try:
    import imageio_ffmpeg

    source = Path(imageio_ffmpeg.get_ffmpeg_exe())
    target_dir = Path(__file__).resolve().parent / ".tools" / "ffmpeg"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / "ffmpeg.exe"
    if not target.exists() or target.stat().st_size != source.stat().st_size:
        shutil.copy2(source, target)
    print(f"Bundled FFmpeg ready: {target}")
except Exception as exc:
    print(f"Could not prepare bundled FFmpeg: {exc}", file=sys.stderr)
    raise
