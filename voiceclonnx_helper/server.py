from __future__ import annotations
import os
import re
import tempfile
import threading
import uuid
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import uvicorn

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
DATA.mkdir(parents=True, exist_ok=True)
REFERENCE = DATA / "reference.wav"
OUTPUTS = DATA / "outputs"
OUTPUTS.mkdir(exist_ok=True)
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
TARGET_RATE = 16000
cloner = None
cloner_lock = threading.Lock()
convert_lock = threading.Lock()

app = FastAPI(title="Local VoiceClonNX Helper", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://[a-p]{32}|http://(127\.0\.0\.1|localhost)(:\d+)?)$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

@app.middleware("http")
async def restrict_local_api(request, call_next):
    origin = request.headers.get("origin")
    if origin and not re.fullmatch(r"(chrome-extension://[a-p]{32}|http://(127\.0\.0\.1|localhost)(:\d+)?)", origin):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=403, content={"detail": "This local helper only accepts requests from the extension or localhost."})
    return await call_next(request)

def read_wav(path: Path):
    try:
        audio, rate = sf.read(str(path), dtype="float32", always_2d=True)
    except Exception as exc:
        raise HTTPException(400, f"Could not read WAV audio: {exc}")
    if audio.size == 0 or rate < 8000:
        raise HTTPException(400, "The WAV file is empty or has an unsupported sample rate.")
    mono = np.mean(audio, axis=1, dtype=np.float32)
    if rate != TARGET_RATE:
        duration = len(mono) / float(rate)
        new_length = max(1, round(duration * TARGET_RATE))
        old_times = np.arange(len(mono), dtype=np.float64) / rate
        new_times = np.arange(new_length, dtype=np.float64) / TARGET_RATE
        mono = np.interp(new_times, old_times, mono).astype(np.float32)
    peak = float(np.max(np.abs(mono))) if mono.size else 0.0
    if peak > 1.0:
        mono = mono / peak
    return mono, TARGET_RATE

def write_normalized_wav(source: Path, target: Path):
    audio, rate = read_wav(source)
    sf.write(str(target), audio, rate, subtype="PCM_16")

async def save_upload(upload: UploadFile, destination: Path):
    name = (upload.filename or "").lower()
    if not name.endswith(".wav"):
        raise HTTPException(400, "Please upload a WAV file.")
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "WAV file is too large (20 MB maximum).")
    if not data:
        raise HTTPException(400, "The uploaded WAV file is empty.")
    destination.write_bytes(data)
    try:
        # Decode now so malformed files fail before entering the conversion pipeline.
        read_wav(destination)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return destination

def get_cloner():
    global cloner
    with cloner_lock:
        if cloner is None:
            from voiceclonnx import VoiceCloner
            cloner = VoiceCloner(engine="facodec")
        return cloner

@app.get("/health")
def health():
    return {"ok": True, "reference_ready": REFERENCE.exists(), "engine": "facodec", "sample_rate": TARGET_RATE}

@app.post("/reference")
async def upload_reference(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory(prefix="voiceclonnx-ref-") as temp_dir:
        raw = Path(temp_dir) / "reference-upload.wav"
        await save_upload(file, raw)
        normalized = Path(temp_dir) / "reference-normalized.wav"
        write_normalized_wav(raw, normalized)
        # Replace the active reference only after the uploaded file validates.
        temp_target = DATA / ("reference-" + uuid.uuid4().hex + ".wav")
        temp_target.write_bytes(normalized.read_bytes())
        temp_target.replace(REFERENCE)
    return {"ok": True, "reference_ready": True, "message": "Reference WAV saved locally."}

@app.post("/convert")
async def convert_phrase(file: UploadFile = File(...)):
    if not REFERENCE.exists():
        raise HTTPException(409, "Choose and save a reference voice WAV first.")
    with tempfile.TemporaryDirectory(prefix="voiceclonnx-source-") as temp_dir:
        raw = Path(temp_dir) / "phrase.wav"
        await save_upload(file, raw)
        source = Path(temp_dir) / "phrase-16k.wav"
        write_normalized_wav(raw, source)
        output = OUTPUTS / ("converted-" + uuid.uuid4().hex + ".wav")
        try:
            # VoiceClonNX runs locally; serialize inference to avoid concurrent model use.
            with convert_lock:
                engine = get_cloner()
                engine.clone_voice(str(source), str(REFERENCE), str(output))
            if not output.exists() or output.stat().st_size < 44:
                raise RuntimeError("VoiceClonNX completed without creating a valid output WAV.")
            return FileResponse(output, media_type="audio/wav", filename=output.name)
        except HTTPException:
            raise
        except Exception as exc:
            output.unlink(missing_ok=True)
            raise HTTPException(500, f"VoiceClonNX conversion failed: {exc}") from exc

if __name__ == "__main__":
    print("VoiceClonNX helper listening at http://127.0.0.1:8765")
    print("Only this computer can connect. Reference WAVs and generated clips stay in voiceclonnx_helper/data/.")
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
