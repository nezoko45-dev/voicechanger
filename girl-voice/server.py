from __future__ import annotations

import os
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

app = FastAPI(title="VoiceChanger VoiceClonNX bridge", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8765", "http://localhost:8765"],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

ENGINES = {"facodec", "openvoice", "chatterbox", "triaan", "cosyvoice",
           "bicodec", "knnvc", "focalcodec", "lscodec", "rvc"}
MAX_UPLOAD_BYTES = 100 * 1024 * 1024


@app.get("/health")
def health():
    return {"ok": True, "service": "voiceclonnx"}


async def save_upload(upload: UploadFile, destination: Path) -> None:
    size = 0
    with destination.open("wb") as target:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="Each audio file must be under 100 MB.")
            target.write(chunk)
    if size == 0:
        raise HTTPException(status_code=400, detail="An uploaded audio file was empty.")


def combine_reference_wavs(first_path: Path, second_path: Path, output_path: Path) -> None:
    """Join two reference WAV clips into one mono WAV at the first clip's sample rate."""
    try:
        first, first_rate = sf.read(str(first_path), dtype="float32", always_2d=True)
        second, second_rate = sf.read(str(second_path), dtype="float32", always_2d=True)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not read reference WAV files. Please select valid WAV audio: {exc}",
        ) from exc

    if first.size == 0 or second.size == 0:
        raise HTTPException(status_code=400, detail="Both reference WAV files must contain audio.")
    if first_rate <= 0 or second_rate <= 0:
        raise HTTPException(status_code=400, detail="A reference WAV has an invalid sample rate.")

    # Convert stereo/multichannel clips to mono before joining.
    first = first.mean(axis=1)
    second = second.mean(axis=1)

    # VoiceClonNX accepts WAV paths. Normalize both clips to the first clip's sample rate
    # so different-rate references are not played back at the wrong speed.
    if second_rate != first_rate:
        new_length = max(1, round(len(second) * first_rate / second_rate))
        old_positions = np.arange(len(second), dtype=np.float64)
        new_positions = np.linspace(0, max(0, len(second) - 1), new_length)
        second = np.interp(new_positions, old_positions, second).astype(np.float32)

    # A short quiet gap keeps the ends of the two utterances from running together.
    silence = np.zeros(round(first_rate * 0.25), dtype=np.float32)
    combined = np.concatenate((first, silence, second))
    sf.write(str(output_path), combined, first_rate, format="WAV", subtype="PCM_16")


@app.post("/convert")
async def convert(
    source_audio: UploadFile = File(...),
    reference_audio_1: UploadFile = File(...),
    reference_audio_2: UploadFile = File(...),
    engine: str = Form("openvoice"),
    quantized: bool = Form(False),
):
    if engine not in ENGINES:
        raise HTTPException(status_code=400, detail=f"Unsupported engine: {engine}")
    temp_dir = Path(tempfile.mkdtemp(prefix="voicechanger-"))
    source_path = temp_dir / ("source" + Path(source_audio.filename or "source.wav").suffix[:10])
    reference_1_path = temp_dir / "reference-1.wav"
    reference_2_path = temp_dir / "reference-2.wav"
    reference_path = temp_dir / "reference-combined.wav"
    output_path = temp_dir / "converted.wav"
    try:
        await save_upload(source_audio, source_path)
        await save_upload(reference_audio_1, reference_1_path)
        await save_upload(reference_audio_2, reference_2_path)
        combine_reference_wavs(reference_1_path, reference_2_path, reference_path)
        try:
            from voiceclonnx import VoiceCloner
            cloner = VoiceCloner(engine=engine, quantized=quantized)
            cloner.clone_voice(str(source_path), str(reference_path), str(output_path))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"VoiceClonNX conversion failed: {exc}") from exc
        if not output_path.exists():
            raise HTTPException(status_code=500, detail="VoiceClonNX did not produce an output file.")

        def cleanup():
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)

        return FileResponse(
            output_path,
            media_type="audio/wav",
            filename="voicechanger-converted.wav",
            background=BackgroundTask(cleanup),
        )
    except Exception:
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    finally:
        await source_audio.close()
        await reference_audio_1.close()
        await reference_audio_2.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
