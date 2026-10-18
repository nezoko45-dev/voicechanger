from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from voiceclonnx import VoiceCloner

app = FastAPI(title="VoiceChanger local voiceclonnx service")
# Local development only. The service binds to loopback in the README instructions.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

ALLOWED_ENGINES = {
    "facodec", "openvoice", "chatterbox", "knnvc", "triaan",
    "cosyvoice", "bicodec", "focalcodec", "lscodec", "rvc",
}


@app.get("/health")
def health():
    return {"ok": True, "service": "voiceclonnx"}


@app.post("/convert")
async def convert(
    source: UploadFile = File(...),
    reference: UploadFile = File(...),
    engine: str = Form("facodec"),
):
    if engine not in ALLOWED_ENGINES:
        raise HTTPException(status_code=400, detail="Unsupported voiceclonnx engine.")
    source_name = (source.filename or "").lower()
    reference_name = (reference.filename or "").lower()
    if not source_name.endswith(".wav"):
        raise HTTPException(status_code=400, detail="Source recording must be WAV.")
    if not reference_name.endswith((".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm")):
        raise HTTPException(status_code=400, detail="Choose a supported audio reference file.")
    with TemporaryDirectory(prefix="voicechanger-") as temp:
        root = Path(temp)
        source_path = root / "source.wav"
        reference_path = root / ("reference" + Path(reference_name).suffix)
        output_path = root / "converted.wav"
        source_path.write_bytes(await source.read())
        reference_path.write_bytes(await reference.read())
        await source.close()
        await reference.close()
        try:
            cloner = VoiceCloner(engine=engine)
            cloner.clone_voice(str(source_path), str(reference_path), str(output_path))
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"voiceclonnx conversion failed: {type(exc).__name__}: {exc}",
            ) from exc
        if not output_path.exists():
            raise HTTPException(status_code=500, detail="Conversion finished without an output file.")
        # Read bytes before TemporaryDirectory is cleaned up.
        output_bytes = output_path.read_bytes()

    from fastapi.responses import Response
    return Response(
        content=output_bytes,
        media_type="audio/wav",
        headers={"Content-Disposition": 'attachment; filename="voicechanger-output.wav"'},
    )
