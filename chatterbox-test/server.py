import os
import tempfile
import threading
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

APP_DIR = Path(__file__).resolve().parent
MODEL_NAME = "Chatterbox Turbo"
app = FastAPI(title="Local Chatterbox Voice Cloning")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://nezoko45-dev.github.io",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

model = None
model_error = None
model_lock = threading.Lock()
generation_lock = threading.Lock()

def load_model():
    global model, model_error
    if model is not None:
        return model
    with model_lock:
        if model is not None:
            return model
        try:
            import torch
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"[Chatterbox] Loading {MODEL_NAME} on {device}...", flush=True)
            model = ChatterboxTurboTTS.from_pretrained(device=device)
            model_error = None
            print(f"[Chatterbox] Model ready on {device}.", flush=True)
            return model
        except Exception as exc:
            model_error = f"{type(exc).__name__}: {exc}"
            print("[Chatterbox] Model load failed:", model_error, flush=True)
            raise

@app.get("/api/status")
def status():
    import importlib.util
    return {
        "ok": True,
        "service": "Local Chatterbox voice cloning",
        "model": MODEL_NAME,
        "model_loaded": model is not None,
        "model_error": model_error,
        "python_package_installed": importlib.util.find_spec("chatterbox") is not None,
    }

@app.post("/api/load")
async def load():
    try:
        await run_in_threadpool(load_model)
        return {"ok": True, "model_loaded": True, "model": MODEL_NAME}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load Chatterbox: {exc}")

@app.post("/api/generate")
async def generate(text: str = Form(...), reference: UploadFile = File(...)):
    clean_text = text.strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Enter the text you want spoken.")
    if len(clean_text) > 5000:
        raise HTTPException(status_code=400, detail="Text is too long (maximum 5,000 characters).")
    if not reference.filename or Path(reference.filename).suffix.lower() != ".wav":
        raise HTTPException(status_code=400, detail="Please upload a WAV reference recording.")
    data = await reference.read()
    if len(data) < 1024:
        raise HTTPException(status_code=400, detail="The reference WAV is empty or too small.")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Reference WAV must be 25 MB or smaller.")

    def do_generate():
        import torchaudio
        engine = load_model()
        with tempfile.TemporaryDirectory(prefix="chatterbox_") as work:
            workdir = Path(work)
            ref_path = workdir / "reference.wav"
            out_path = workdir / "cloned-voice.wav"
            ref_path.write_bytes(data)
            with generation_lock:
                print("[Chatterbox] Generating cloned speech...", flush=True)
                audio = engine.generate(clean_text, audio_prompt_path=str(ref_path))
                torchaudio.save(str(out_path), audio.detach().cpu(), engine.sr)
            return out_path.read_bytes()

    try:
        output = await run_in_threadpool(do_generate)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Voice generation failed: {type(exc).__name__}: {exc}")

    fd, final_path = tempfile.mkstemp(prefix="chatterbox_output_", suffix=".wav")
    os.close(fd)
    Path(final_path).write_bytes(output)
    return FileResponse(
        final_path,
        media_type="audio/wav",
        filename="chatterbox-cloned-voice.wav",
        background=BackgroundTask(lambda: Path(final_path).unlink(missing_ok=True)),
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
