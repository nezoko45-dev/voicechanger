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


VOICEBOX_DEFAULT_URL = "http://127.0.0.1:17493"


def _voicebox_base(url: str) -> str:
    from urllib.parse import urlparse

    parsed = urlparse(url or VOICEBOX_DEFAULT_URL)
    # Only talk to a Voicebox running on this machine.
    if parsed.scheme not in ("http", "https") or parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise HTTPException(status_code=400, detail="Voicebox URL must point to localhost.")
    return f"{parsed.scheme}://{parsed.netloc}"


@app.post("/voicebox/convert")
async def voicebox_convert(
    source: UploadFile = File(...),
    reference: UploadFile = File(...),
    voicebox_url: str = Form(VOICEBOX_DEFAULT_URL),
    language: str = Form("en"),
):
    """Clone the reference voice in Voicebox and re-speak the source recording.

    Voicebox is a TTS studio (no direct voice-to-voice endpoint), so this:
    transcribes the reference and source, creates a temporary cloned profile from
    the reference, generates the source transcript in that voice, then deletes the profile.
    """
    import uuid

    import httpx

    base = _voicebox_base(voicebox_url)
    source_bytes = await source.read()
    reference_bytes = await reference.read()
    await source.close()
    await reference.close()
    profile_id = None
    timeout = httpx.Timeout(600.0, connect=5.0)
    async with httpx.AsyncClient(base_url=base, timeout=timeout) as client:

        async def call(method: str, path: str, step: str, **kwargs):
            try:
                response = await client.request(method, path, **kwargs)
            except httpx.ConnectError as exc:
                raise HTTPException(
                    status_code=502,
                    detail=f"Cannot reach Voicebox at {base}. Start the Voicebox app first.",
                ) from exc
            if response.status_code >= 400:
                try:
                    detail = response.json().get("detail", response.text)
                except Exception:
                    detail = response.text
                raise HTTPException(status_code=502, detail=f"Voicebox {step} failed: {detail}")
            return response

        try:
            ref_text = (await call(
                "POST", "/transcribe", "reference transcription",
                files={"file": ("reference.wav", reference_bytes, "audio/wav")},
            )).json().get("text", "").strip()
            if not ref_text:
                raise HTTPException(status_code=400, detail="Could not find speech in the reference voice file.")
            text = (await call(
                "POST", "/transcribe", "source transcription",
                files={"file": ("source.wav", source_bytes, "audio/wav")},
            )).json().get("text", "").strip()
            if not text:
                raise HTTPException(status_code=400, detail="Could not find speech in the source recording.")
            profile_id = (await call(
                "POST", "/profiles", "profile creation",
                json={"name": f"voicechanger-{uuid.uuid4().hex[:8]}", "language": language, "voice_type": "cloned"},
            )).json()["id"]
            await call(
                "POST", f"/profiles/{profile_id}/samples", "sample upload",
                files={"file": ("reference.wav", reference_bytes, "audio/wav")},
                data={"reference_text": ref_text},
            )
            audio = await call(
                "POST", "/generate/stream", "generation",
                json={"profile_id": profile_id, "text": text, "language": language},
            )
            wav = audio.content
        finally:
            if profile_id:
                try:
                    await client.delete(f"/profiles/{profile_id}")
                except Exception:
                    pass

    from fastapi.responses import Response
    return Response(
        content=wav,
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
