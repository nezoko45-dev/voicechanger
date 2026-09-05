import asyncio
import io
import json
import os
import subprocess
import sys
import tempfile
import wave
from pathlib import Path


def ensure_dependencies():
    packages = [
        "rvc-python==0.1.5",
        "numpy>=1.26,<3",
        "soundfile>=0.12.1",
        "websockets>=12,<16",
    ]
    try:
        import rvc_python  # noqa: F401
        import numpy  # noqa: F401
        import soundfile  # noqa: F401
        import websockets  # noqa: F401
        return
    except ImportError:
        print("Installing RVC dependencies automatically...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", *packages])


ensure_dependencies()

import numpy as np
import soundfile as sf
import websockets
from rvc_python.infer import RVCInference

HOST = os.getenv("RVC_HOST", "127.0.0.1")
PORT = int(os.getenv("RVC_PORT", "8765"))
BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models"
DEVICE = os.getenv("RVC_DEVICE", "")
MAX_MODEL_SIZE = 2 * 1024 * 1024 * 1024

converter = None
current_model = None
pitch_shift = 8


def cuda_available():
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


def get_device():
    return DEVICE or ("cuda:0" if cuda_available() else "cpu")


def find_models():
    MODEL_DIR.mkdir(exist_ok=True)
    return sorted(MODEL_DIR.glob("*.pth"))


def load_converter(model_path=None):
    global converter, current_model
    models = find_models()
    if model_path:
        path = Path(model_path).expanduser()
        if not path.is_absolute():
            path = BASE_DIR / path
    elif current_model and Path(current_model).exists():
        path = Path(current_model)
    elif models:
        path = models[0]
    else:
        raise RuntimeError("No .pth RVC model found. Upload a .pth file with the webpage.")

    if not path.exists() or path.suffix.lower() != ".pth":
        raise RuntimeError(f"RVC model not found: {path}")

    print(f"Loading RVC model: {path}")
    converter = RVCInference(device=get_device())
    converter.load_model(str(path))
    current_model = str(path)
    print(f"RVC model ready on {get_device()}: {path.name}")


def pcm_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()


def wav_to_packet(path: Path) -> bytes:
    audio, rate = sf.read(str(path), dtype="int16", always_2d=False)
    if getattr(audio, "ndim", 1) > 1:
        audio = audio[:, 0]
    audio = np.asarray(audio, dtype=np.int16)
    return int(rate).to_bytes(4, "little") + audio.tobytes()


def convert_chunk(pcm: bytes, sample_rate: int) -> bytes:
    if converter is None:
        load_converter()
    with tempfile.TemporaryDirectory(prefix="rvc_chunk_") as d:
        src = Path(d) / "input.wav"
        dst = Path(d) / "output.wav"
        src.write_bytes(pcm_to_wav(pcm, sample_rate))
        converter.infer_file(str(src), str(dst))
        return wav_to_packet(dst)


async def send_models(ws):
    await ws.send(json.dumps({
        "type": "models",
        "models": [p.name for p in find_models()],
    }))


async def handler(ws):
    await ws.send(json.dumps({
        "type": "ready",
        "device": get_device(),
        "models": [p.name for p in find_models()],
    }))

    upload = None
    async for message in ws:
        if isinstance(message, str):
            if message == "LIST_MODELS":
                await send_models(ws)
                continue

            if message.startswith("MODEL "):
                try:
                    requested = message[6:].strip()
                    load_converter(requested or None)
                    await ws.send(json.dumps({
                        "type": "model_loaded",
                        "model": Path(current_model).name,
                    }))
                except Exception as exc:
                    await ws.send(json.dumps({"type": "error", "message": str(exc)}))
                continue

            if message.startswith("UPLOAD_MODEL "):
                try:
                    parts = message.split(" ", 2)
                    name = Path(parts[1]).name
                    size = int(parts[2])
                    if not name.lower().endswith(".pth"):
                        raise ValueError("Only .pth RVC models are supported.")
                    if size <= 0 or size > MAX_MODEL_SIZE:
                        raise ValueError("Model file is too large or empty.")
                    MODEL_DIR.mkdir(exist_ok=True)
                    destination = MODEL_DIR / name
                    upload = {
                        "path": destination,
                        "size": size,
                        "received": 0,
                        "file": destination.open("wb"),
                    }
                    await ws.send(json.dumps({"type": "upload_started", "model": name, "size": size}))
                except Exception as exc:
                    upload = None
                    await ws.send(json.dumps({"type": "error", "message": str(exc)}))
                continue

            try:
                data = json.loads(message)
                if data.get("type") == "settings":
                    global pitch_shift
                    pitch_shift = int(data.get("pitch", 8))
                    await ws.send(json.dumps({"type": "settings", "pitch": pitch_shift}))
            except json.JSONDecodeError:
                pass
            continue

        # Binary messages are either model-upload chunks or PCM16 audio.
        if upload is not None:
            try:
                upload["file"].write(message)
                upload["received"] += len(message)
                if upload["received"] > upload["size"]:
                    raise ValueError("Model upload exceeded declared size.")
                if upload["received"] == upload["size"]:
                    upload["file"].close()
                    path = upload["path"]
                    upload = None
                    await ws.send(json.dumps({"type": "upload_complete", "model": path.name}))
                    await asyncio.to_thread(load_converter, str(path))
                    await ws.send(json.dumps({"type": "model_loaded", "model": path.name}))
            except Exception as exc:
                try:
                    upload["file"].close()
                except Exception:
                    pass
                upload = None
                await ws.send(json.dumps({"type": "error", "message": str(exc)}))
            continue

        try:
            if len(message) < 5:
                continue
            rate = int.from_bytes(message[:4], "little")
            pcm = message[4:]
            output = await asyncio.to_thread(convert_chunk, pcm, rate)
            await ws.send(output)
        except Exception as exc:
            await ws.send(json.dumps({"type": "error", "message": str(exc)}))

    if upload is not None:
        try:
            upload["file"].close()
        except Exception:
            pass


async def main():
    models = find_models()
    print("========================================")
    print(" RVC Live Voice Changer server")
    print("========================================")
    print(f"Python: {sys.version.split()[0]}")
    print(f"Device: {get_device()}")
    print(f"Models folder: {MODEL_DIR}")
    print(f"Models found: {[p.name for p in models] or 'NONE'}")
    if models:
        try:
            load_converter()
        except Exception as exc:
            print(f"Model load failed: {exc}")
    else:
        print("No model yet. Upload one from the webpage.")
    print(f"Listening on ws://{HOST}:{PORT}")
    print("Keep this window open while using the website.")
    async with websockets.serve(handler, HOST, PORT, max_size=16 * 1024 * 1024):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nRVC server stopped.")
