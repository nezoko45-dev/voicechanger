import asyncio
import io
import json
import os
import tempfile
import wave
from pathlib import Path

import numpy as np
import soundfile as sf
import websockets


def cuda_available():
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


try:
    from rvc_python.infer import RVCInference
except ImportError as exc:
    raise SystemExit(
        "RVC is not installed. Run: pip install -r requirements-rvc.txt"
    ) from exc

HOST = os.getenv("RVC_HOST", "127.0.0.1")
PORT = int(os.getenv("RVC_PORT", "8765"))
MODEL = os.getenv("RVC_MODEL", "")
DEVICE = os.getenv("RVC_DEVICE", "cuda:0" if cuda_available() else "cpu")

converter = None


def load_converter(model_path: str):
    global converter
    if not model_path:
        raise RuntimeError("No RVC model selected. Set RVC_MODEL to a .pth model path.")
    if not Path(model_path).exists():
        raise RuntimeError(f"RVC model not found: {model_path}")
    print(f"Loading RVC model: {model_path} on {DEVICE}")
    converter = RVCInference(device=DEVICE)
    converter.load_model(model_path)
    print("RVC model ready")


def pcm_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    arr = np.frombuffer(pcm, dtype=np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(arr.tobytes())
    return buf.getvalue()


def convert_chunk(pcm: bytes, sample_rate: int) -> bytes:
    if converter is None:
        raise RuntimeError("RVC converter is not loaded")

    with tempfile.TemporaryDirectory(prefix="rvc_chunk_") as d:
        src = Path(d) / "input.wav"
        dst = Path(d) / "output.wav"
        src.write_bytes(pcm_to_wav(pcm, sample_rate))
        converter.infer_file(str(src), str(dst))
        audio, rate = sf.read(str(dst), dtype="int16", always_2d=False)
        if getattr(audio, "ndim", 1) > 1:
            audio = audio[:, 0]
        out = io.BytesIO()
        with wave.open(out, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(int(rate))
            w.writeframes(np.asarray(audio, dtype=np.int16).tobytes())
        return out.getvalue()


async def handler(ws):
    await ws.send(json.dumps({"type": "ready", "device": DEVICE}))
    async for message in ws:
        if isinstance(message, str):
            if message.startswith("MODEL "):
                try:
                    load_converter(message[6:].strip())
                    await ws.send(json.dumps({"type": "model_loaded"}))
                except Exception as exc:
                    await ws.send(json.dumps({"type": "error", "message": str(exc)}))
            continue

        try:
            # First 4 bytes are little-endian sample rate, followed by PCM16 mono.
            if len(message) < 5:
                continue
            rate = int.from_bytes(message[:4], "little")
            pcm = message[4:]
            output = await asyncio.to_thread(convert_chunk, pcm, rate)
            await ws.send(output)
        except Exception as exc:
            await ws.send(json.dumps({"type": "error", "message": str(exc)}))


async def main():
    if MODEL:
        load_converter(MODEL)
    else:
        print("RVC_MODEL is not set. The server will wait for a MODEL command.")
    print(f"RVC websocket server: ws://{HOST}:{PORT}")
    async with websockets.serve(handler, HOST, PORT, max_size=16 * 1024 * 1024):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
