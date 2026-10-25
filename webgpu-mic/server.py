from __future__ import annotations

import os
import shutil
import sys
import tempfile
import threading
import webbrowser
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from starlette.background import BackgroundTask

def resource_path(name: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / name


app = FastAPI(title="VoiceChanger VoiceClonNX bridge", version="1.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

ENGINES = {"facodec", "openvoice", "chatterbox", "triaan", "cosyvoice",
           "bicodec", "knnvc", "focalcodec", "lscodec", "rvc"}
MAX_UPLOAD_BYTES = 100 * 1024 * 1024


@app.get("/", response_class=HTMLResponse)
def home():
    page = resource_path("index.html")
    if not page.exists():
        raise HTTPException(status_code=404, detail="index.html was not bundled with this app.")
    return HTMLResponse(page.read_text(encoding="utf-8"))


@app.get("/model-probe.html", response_class=HTMLResponse)
def model_probe():
    page = resource_path("model-probe.html")
    if not page.exists():
        raise HTTPException(status_code=404, detail="model-probe.html was not bundled with this app.")
    return HTMLResponse(page.read_text(encoding="utf-8"))


@app.get("/health")
def health():
    return {"ok": True, "service": "voiceclonnx", "engines": sorted(ENGINES)}


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


def combine_reference_wavs(paths: list[Path], output_path: Path) -> None:
    clips = []
    sample_rate = None
    for path in paths:
        try:
            audio, rate = sf.read(str(path), dtype="float32", always_2d=True)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Could not read reference WAV. Please select a valid WAV file: {exc}",
            ) from exc
        if audio.size == 0 or rate <= 0:
            raise HTTPException(status_code=400, detail="Reference WAV must contain valid audio.")
        audio = audio.mean(axis=1)
        if sample_rate is None:
            sample_rate = rate
        elif rate != sample_rate:
            new_length = max(1, round(len(audio) * sample_rate / rate))
            audio = np.interp(
                np.linspace(0, max(0, len(audio) - 1), new_length),
                np.arange(len(audio), dtype=np.float64),
                audio,
            ).astype(np.float32)
        clips.append(audio)
    silence = np.zeros(round(sample_rate * 0.25), dtype=np.float32)
    combined = clips[0] if len(clips) == 1 else np.concatenate(
        [part for pair in zip(clips, [silence] * len(clips)) for part in pair][:-1]
    )
    sf.write(str(output_path), combined, sample_rate, format="WAV", subtype="PCM_16")


@app.post("/convert")
async def convert(
    source_audio: UploadFile = File(...),
    reference_audio: UploadFile | None = File(None),
    reference_audio_1: UploadFile | None = File(None),
    reference_audio_2: UploadFile | None = File(None),
    engine: str = Form("facodec"),
    quantized: bool = Form(False),
):
    if engine not in ENGINES:
        raise HTTPException(status_code=400, detail=f"Unsupported engine: {engine}")
    refs = [f for f in (reference_audio, reference_audio_1, reference_audio_2) if f is not None]
    if not refs:
        raise HTTPException(status_code=400, detail="Upload a reference WAV file.")
    temp_dir = Path(tempfile.mkdtemp(prefix="voicechanger-"))
    source_path = temp_dir / "source.wav"
    ref_paths = [temp_dir / f"reference-{i}.wav" for i in range(len(refs))]
    reference_path = temp_dir / "reference-combined.wav"
    output_path = temp_dir / "converted.wav"
    try:
        await save_upload(source_audio, source_path)
        for upload, path in zip(refs, ref_paths):
            await save_upload(upload, path)
        combine_reference_wavs(ref_paths, reference_path)
        try:
            from voiceclonnx import VoiceCloner
            cloner = VoiceCloner(engine=engine, quantized=quantized)
            cloner.clone_voice(str(source_path), str(reference_path), str(output_path))
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"VoiceClonNX conversion failed: {type(exc).__name__}: {exc}",
            ) from exc
        if not output_path.exists() or output_path.stat().st_size == 0:
            raise HTTPException(status_code=500, detail="VoiceClonNX did not produce an output file.")
        return FileResponse(
            output_path,
            media_type="audio/wav",
            filename="voiceclonnx-converted.wav",
            background=BackgroundTask(lambda: shutil.rmtree(temp_dir, ignore_errors=True)),
        )
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    finally:
        await source_audio.close()
        for upload in refs:
            await upload.close()


if __name__ == "__main__":
    import uvicorn
    url = "http://127.0.0.1:8765/"
    threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
