from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

app = FastAPI(title="VoiceChanger VoiceClonNX bridge", version="1.0.0")
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


@app.post("/convert")
async def convert(
    source_audio: UploadFile = File(...),
    reference_audio: UploadFile = File(...),
    engine: str = Form("openvoice"),
    quantized: bool = Form(False),
):
    if engine not in ENGINES:
        raise HTTPException(status_code=400, detail=f"Unsupported engine: {engine}")
    temp_dir = Path(tempfile.mkdtemp(prefix="voicechanger-"))
    source_path = temp_dir / ("source" + Path(source_audio.filename or "source.wav").suffix[:10])
    reference_path = temp_dir / ("reference" + Path(reference_audio.filename or "reference.wav").suffix[:10])
    output_path = temp_dir / "converted.wav"
    try:
        await save_upload(source_audio, source_path)
        await save_upload(reference_audio, reference_path)
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
        await reference_audio.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
