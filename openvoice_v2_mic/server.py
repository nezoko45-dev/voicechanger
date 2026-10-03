import asyncio, json, tempfile, uuid
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from fastapi import FastAPI, File, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from voiceclonnx import VoiceCloner

ROOT = Path(__file__).resolve().parent
VOICE_DIR = ROOT / "voices"
VOICE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

cloner = None
reference = None
lock = asyncio.Lock()
TARGET_SR = 22050
STREAM_SECONDS = 0.20

@app.get("/")
def index():
    return FileResponse(ROOT / "index.html")

@app.get("/health")
def health():
    return {"ok": True, "engine": "openvoice-v2", "sample_rate": TARGET_SR, "stream_seconds": STREAM_SECONDS}

@app.post("/reference")
async def reference_upload(file: UploadFile = File(...)):
    global reference
    data = await file.read()
    if not data:
        raise ValueError("Reference audio upload was empty")
    p = VOICE_DIR / ("reference_" + uuid.uuid4().hex + ".wav")
    p.write_bytes(data)
    try:
        info = sf.info(p)
        if info.samplerate != TARGET_SR or info.channels != 1 or info.subtype != "PCM_16":
            audio, sr = sf.read(p, dtype="float32", always_2d=False)
            if audio.ndim > 1:
                audio = np.mean(audio, axis=1)
            if sr != TARGET_SR:
                audio = resample_poly(audio, TARGET_SR, sr)
            sf.write(p, np.asarray(audio, dtype=np.float32), TARGET_SR, subtype="PCM_16")
        sf.read(p, dtype="float32")
    except Exception:
        try: p.unlink()
        except OSError: pass
        raise ValueError("Reference audio is not a valid PCM WAV after normalization")
    reference = p
    return {"ok": True, "reference": p.name, "sample_rate": TARGET_SR}

def _resample_mono(audio, source_sr, target_sr):
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)
    if source_sr == target_sr:
        return audio
    return np.asarray(resample_poly(audio, target_sr, source_sr), dtype=np.float32)

def convert_chunk(pcm16: bytes, sample_rate: int):
    global cloner, reference
    if reference is None:
        raise RuntimeError("No reference WAV selected")
    audio = np.frombuffer(pcm16, dtype="<i2").astype(np.float32) / 32768.0
    if audio.size < int(sample_rate * 0.15):
        return None
    audio = _resample_mono(audio, sample_rate, TARGET_SR)

    src_fd, src_name = tempfile.mkstemp(suffix=".wav", dir=VOICE_DIR)
    out_fd, out_name = tempfile.mkstemp(suffix=".wav", dir=VOICE_DIR)
    import os
    os.close(src_fd)
    os.close(out_fd)
    src = Path(src_name)
    out = Path(out_name)
    try:
        sf.write(src, audio, TARGET_SR, subtype="PCM_16")
        result = cloner.clone_voice(str(src), str(reference), str(out))
        output_path = Path(result) if result else out
        if not output_path.exists():
            raise RuntimeError("OpenVoice returned no output WAV")
        data = output_path.read_bytes()
        if not data:
            raise RuntimeError("OpenVoice returned an empty WAV")
        return data
    finally:
        for p in (src, out):
            try: p.unlink()
            except OSError: pass

@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    try:
        cfg = json.loads(await websocket.receive_text())
        sr = int(cfg.get("sampleRate", 16000))
        if sr < 8000 or sr > 48000: sr = 16000
        requested = float(cfg.get("windowSeconds", STREAM_SECONDS))
        window = min(0.20, max(0.20, requested))
        await websocket.send_text("Loading OpenVoice V2 ONNX engine…")
        global cloner
        if cloner is None:
            cloner = VoiceCloner(engine="openvoice", quantized=False)
        await websocket.send_text("OpenVoice V2 ready. 200ms low-latency pipeline active.")
        buf = bytearray()
        target_bytes = int(sr * window * 2)
        while True:
            msg = await websocket.receive()
            if "bytes" not in msg or msg["bytes"] is None: continue
            buf.extend(msg["bytes"])
            while len(buf) >= target_bytes:
                chunk = bytes(buf[:target_bytes]); del buf[:target_bytes]
                async with lock:
                    try:
                        data = await asyncio.to_thread(convert_chunk, chunk, sr)
                        if data: await websocket.send_bytes(data)
                    except Exception as e:
                        await websocket.send_text("Conversion error: " + str(e))
    except Exception:
        return
