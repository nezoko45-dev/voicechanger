import io
import os
import torch
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from qwen_tts import Qwen3TTSModel

MODEL = os.getenv("QWEN_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice")
DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
DTYPE = torch.bfloat16 if torch.cuda.is_available() else torch.float32

app = FastAPI(title="Local Qwen3-TTS Ono Anna")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

print(f"Loading {MODEL} on {DEVICE}...")
model = Qwen3TTSModel.from_pretrained(MODEL, device_map=DEVICE, dtype=DTYPE)
print("Qwen3-TTS loaded. Speaker: Ono_Anna")

class SpeechRequest(BaseModel):
    input: str
    voice: str = "Ono_Anna"
    language: str = "English"
    response_format: str = "wav"
    instruct: str = ""

@app.get("/health")
def health():
    return {"ready": True, "model": MODEL, "speaker": "Ono_Anna", "device": DEVICE}

@app.get("/v1/models")
def models():
    return {"data": [{"id": MODEL, "object": "model"}]}

@app.post("/v1/audio/speech")
def speech(req: SpeechRequest):
    text = req.input.strip()
    if not text:
        raise HTTPException(400, "input is empty")
    if req.voice.lower() != "ono_anna".lower():
        raise HTTPException(400, "This server is configured for Ono_Anna")
    try:
        wavs, sr = model.generate_custom_voice(
            text=text,
            language=req.language,
            speaker="Ono_Anna",
            instruct=req.instruct or None,
            max_new_tokens=2048,
        )
        buf = io.BytesIO()
        sf.write(buf, wavs[0], sr, format="WAV", subtype="PCM_16")
        return Response(content=buf.getvalue(), media_type="audio/wav", headers={"Cache-Control": "no-store"})
    except Exception as exc:
        raise HTTPException(500, str(exc))

@app.get("/")
def root():
    return JSONResponse({"service": "Qwen3-TTS", "speaker": "Ono_Anna", "model": MODEL, "health": "/health"})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8100)
