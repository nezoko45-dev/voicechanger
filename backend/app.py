from pathlib import Path
from tempfile import TemporaryDirectory
import sys

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from voiceclonnx import VoiceCloner

app = FastAPI(title="VoiceChanger local voiceclonnx service")

def _asset_path(name: str) -> Path:
    """Find UI assets both in the source checkout and a PyInstaller bundle."""
    bundle_root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    return bundle_root / name


@app.get("/", include_in_schema=False)
def web_ui():
    return FileResponse(_asset_path("popup.html"), media_type="text/html")


@app.get("/styles.css", include_in_schema=False)
def web_styles():
    return FileResponse(_asset_path("styles.css"), media_type="text/css")


@app.get("/popup.js", include_in_schema=False)
def web_script():
    return FileResponse(_asset_path("popup.js"), media_type="text/javascript")


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


@app.websocket("/live")
async def live_convert(websocket: WebSocket):
    """Experimental chunk-based live conversion over a local WebSocket.

    The browser sends a JSON start message with an engine and base64 WAV reference,
    then sends short mono/stereo PCM WAV chunks as binary messages. Conversion is
    sequential; this is not a zero-latency streaming model API.
    """
    import asyncio
    import base64
    import json
    from fastapi import WebSocketDisconnect

    await websocket.accept()
    try:
        config = json.loads(await websocket.receive_text())
        engine = config.get("engine", "facodec")
        if engine not in ALLOWED_ENGINES:
            await websocket.send_text(json.dumps({"error": "Unsupported voiceclonnx engine."}))
            await websocket.close(code=1008)
            return
        reference_b64 = config.get("reference_wav_base64", "")
        if not reference_b64:
            await websocket.send_text(json.dumps({"error": "Select a reference voice first."}))
            await websocket.close(code=1008)
            return
        try:
            reference_bytes = base64.b64decode(reference_b64, validate=True)
        except Exception:
            await websocket.send_text(json.dumps({"error": "Reference WAV data was invalid."}))
            await websocket.close(code=1008)
            return

        with TemporaryDirectory(prefix="voicechanger-live-") as temp:
            root = Path(temp)
            reference_path = root / "reference.wav"
            source_path = root / "live-chunk.wav"
            output_path = root / "live-output.wav"
            reference_path.write_bytes(reference_bytes)

            try:
                # Initialize once per session rather than reloading the model per chunk.
                cloner = await asyncio.to_thread(VoiceCloner, engine=engine)
            except Exception as exc:
                await websocket.send_text(json.dumps({
                    "error": f"Could not initialize {engine}: {type(exc).__name__}: {exc}"
                }))
                await websocket.close(code=1011)
                return

            await websocket.send_text(json.dumps({"status": "ready", "message": "Live conversion model ready."}))
            while True:
                chunk = await websocket.receive_bytes()
                if not chunk or not chunk.startswith(b"RIFF") or b"WAVE" not in chunk[:16]:
                    await websocket.send_text(json.dumps({"error": "Received an invalid WAV chunk."}))
                    continue
                source_path.write_bytes(chunk)
                if output_path.exists():
                    output_path.unlink()
                try:
                    await asyncio.to_thread(
                        cloner.clone_voice, str(source_path), str(reference_path), str(output_path)
                    )
                    if not output_path.exists():
                        raise RuntimeError("voiceclonnx returned without creating output audio")
                    await websocket.send_bytes(output_path.read_bytes())
                except Exception as exc:
                    await websocket.send_text(json.dumps({
                        "error": f"Live chunk conversion failed: {type(exc).__name__}: {exc}"
                    }))
    except WebSocketDisconnect:
        return
    except Exception as exc:
        try:
            await websocket.send_text(json.dumps({"error": f"Live session failed: {type(exc).__name__}: {exc}"}))
            await websocket.close(code=1011)
        except Exception:
            pass
