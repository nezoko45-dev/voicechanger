import asyncio
import json
import os
import tempfile
import uuid
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from scipy.signal import resample_poly
from voiceclonnx import VoiceCloner

ROOT = Path(__file__).resolve().parent
VOICE_DIR = ROOT / "voices"
VOICE_DIR.mkdir(parents=True, exist_ok=True)
INPUT_SR = 16000
ENGINE_SR = 22050
WINDOW_SECONDS = 0.608
MAX_AUDIO_QUEUE = 3
MAX_OUTPUT_QUEUE = 2
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
cloner = None
reference = None
engine_lock = asyncio.Lock()

@app.get("/")
def index(): return FileResponse(ROOT / "index.html")

@app.get("/health")
def health():
    return {"ok": True, "engine": "openvoice-v2", "input_sample_rate": INPUT_SR, "engine_sample_rate": ENGINE_SR, "window_seconds": WINDOW_SECONDS}

@app.post("/reference")
async def upload_reference(file: UploadFile = File(...)):
    global reference
    data = await file.read()
    if not data: raise ValueError("Reference audio upload was empty")
    path = VOICE_DIR / f"reference_{uuid.uuid4().hex}.wav"
    path.write_bytes(data)
    try:
        audio, sr = sf.read(path, dtype="float32", always_2d=False)
        if audio.ndim > 1: audio = np.mean(audio, axis=1)
        if sr != ENGINE_SR: audio = resample_poly(audio, ENGINE_SR, sr)
        audio = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
        sf.write(path, audio, ENGINE_SR, subtype="PCM_16")
    except Exception as exc:
        try: path.unlink()
        except OSError: pass
        raise ValueError(f"Reference WAV could not be normalized: {exc}") from exc
    old = reference
    reference = path
    if old and old != path:
        try: old.unlink()
        except OSError: pass
    return {"ok": True, "reference": path.name, "sample_rate": ENGINE_SR}

async def ensure_engine():
    global cloner
    if cloner is not None: return cloner
    async with engine_lock:
        if cloner is None:
            print("[OpenVoice] Loading engine...", flush=True)
            cloner = await asyncio.to_thread(VoiceCloner, engine="openvoice", quantized=False)
            print("[OpenVoice] Engine ready", flush=True)
    return cloner

def convert_chunk(pcm_bytes: bytes, sample_rate: int, reference_path: Path):
    audio = np.frombuffer(pcm_bytes, dtype="<i2").astype(np.float32) / 32768.0
    if audio.size < int(sample_rate * WINDOW_SECONDS): return None
    if sample_rate != ENGINE_SR: audio = resample_poly(audio, ENGINE_SR, sample_rate)
    src_fd, src_name = tempfile.mkstemp(suffix=".wav", dir=VOICE_DIR); os.close(src_fd)
    out_fd, out_name = tempfile.mkstemp(suffix=".wav", dir=VOICE_DIR); os.close(out_fd)
    src, out = Path(src_name), Path(out_name)
    try:
        sf.write(src, np.asarray(audio, dtype=np.float32), ENGINE_SR, subtype="PCM_16")
        result = cloner.clone_voice(str(src), str(reference_path), str(out))
        output_path = Path(result) if result else out
        if not output_path.exists(): raise RuntimeError("OpenVoice returned no output WAV")
        data = output_path.read_bytes()
        if not data: raise RuntimeError("OpenVoice returned empty audio")
        return data
    finally:
        for item in (src, out):
            try: item.unlink()
            except OSError: pass

async def receive_audio(websocket, audio_queue, state):
    while not state["closed"]:
        message = await websocket.receive()
        if message.get("type") == "websocket.disconnect":
            state["closed"] = True; return
        data = message.get("bytes")
        if not data: continue
        if audio_queue.full():
            try: audio_queue.get_nowait()
            except asyncio.QueueEmpty: pass
        try: audio_queue.put_nowait(data)
        except asyncio.QueueFull: pass

async def convert_audio(audio_queue, output_queue, sample_rate, reference_path, state):
    while not state["closed"]:
        chunk = await audio_queue.get()
        try:
            data = await asyncio.to_thread(convert_chunk, chunk, sample_rate, reference_path)
            if not data: continue
            if output_queue.full():
                try: output_queue.get_nowait()
                except asyncio.QueueEmpty: pass
            try: output_queue.put_nowait(data)
            except asyncio.QueueFull: pass
        except Exception as exc:
            print(f"[OpenVoice] Conversion error: {exc!r}", flush=True)
            state["last_error"] = str(exc)

async def send_audio(websocket, output_queue, state):
    while not state["closed"]:
        data = await output_queue.get()
        try: await websocket.send_bytes(data)
        except Exception:
            state["closed"] = True; return

async def heartbeat(websocket, state):
    while not state["closed"]:
        await asyncio.sleep(5)
        try: await websocket.send_text("KEEPALIVE")
        except Exception:
            state["closed"] = True; return

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    state = {"closed": False, "last_error": None}
    tasks = []
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), 15)
        config = json.loads(raw)
        sample_rate = int(config.get("sampleRate", INPUT_SR))
        if sample_rate < 8000 or sample_rate > 48000: sample_rate = INPUT_SR
        await websocket.send_text("Loading OpenVoice V2...")
        await ensure_engine()
        reference_path = reference
        if reference_path is None or not reference_path.exists():
            await websocket.send_text("ERROR: Select a reference WAV first")
            await websocket.close(code=1008, reason="reference required")
            return
        await websocket.send_text("OpenVoice V2 ready")
        audio_queue = asyncio.Queue(maxsize=MAX_AUDIO_QUEUE)
        output_queue = asyncio.Queue(maxsize=MAX_OUTPUT_QUEUE)
        tasks = [
            asyncio.create_task(receive_audio(websocket, audio_queue, state)),
            asyncio.create_task(convert_audio(audio_queue, output_queue, sample_rate, reference_path, state)),
            asyncio.create_task(send_audio(websocket, output_queue, state)),
            asyncio.create_task(heartbeat(websocket, state)),
        ]
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            try: task.result()
            except (WebSocketDisconnect, asyncio.CancelledError): pass
            except Exception as exc: print(f"[OpenVoice] Worker stopped: {exc!r}", flush=True)
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except Exception as exc:
        print(f"[OpenVoice] WebSocket error: {exc!r}", flush=True)
    finally:
        state["closed"] = True
        for task in tasks:
            if not task.done(): task.cancel()
        if tasks: await asyncio.gather(*tasks, return_exceptions=True)
        try: await websocket.close()
        except Exception: pass
