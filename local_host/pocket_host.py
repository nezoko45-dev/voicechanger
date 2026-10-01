import asyncio
import base64
import json
import os
import tempfile
from pathlib import Path

import numpy as np
import websockets
from pocket_tts import TTSModel

HOST = "127.0.0.1"
PORT = 8765
VOICE_FILE = Path(__file__).with_name("reference.wav")

model = None
voice_state = None
model_lock = asyncio.Lock()

async def load_voice(wav_path: Path):
    global voice_state
    async with model_lock:
        voice_state = await asyncio.to_thread(model.get_state_for_audio_prompt, str(wav_path))

async def send_json(ws, payload):
    await ws.send(json.dumps(payload))

async def handle(ws):
    await send_json(ws, {"type": "ready", "message": "Pocket TTS native host ready"})
    async for message in ws:
        try:
            if isinstance(message, bytes):
                continue
            msg = json.loads(message)
            kind = msg.get("type")

            if kind == "ping":
                await send_json(ws, {"type": "pong"})

            elif kind == "load-reference":
                data = base64.b64decode(msg.get("data", ""))
                if not data:
                    raise ValueError("Reference WAV data is empty")
                VOICE_FILE.write_bytes(data)
                await send_json(ws, {"type": "reference-loading", "name": msg.get("name", "reference.wav")})
                await load_voice(VOICE_FILE)
                await send_json(ws, {"type": "reference-ready", "name": msg.get("name", "reference.wav")})

            elif kind == "speak":
                text = str(msg.get("text", "")).strip()
                if not text:
                    continue
                if voice_state is None:
                    raise RuntimeError("No WAV voice is loaded")

                await send_json(ws, {"type": "generation-start", "text": text})

                # Stream PCM chunks as soon as Pocket TTS decodes them.
                def generate():
                    return model.generate_audio_stream(voice_state, text, copy_state=True)

                stream = await asyncio.to_thread(generate)
                while True:
                    try:
                        chunk = await asyncio.to_thread(next, stream)
                    except StopIteration:
                        break
                    pcm = np.asarray(chunk.detach().cpu().numpy(), dtype=np.float32)
                    await ws.send(pcm.tobytes())

                await send_json(ws, {"type": "generation-done", "sampleRate": model.sample_rate})

            elif kind == "stop":
                await send_json(ws, {"type": "stopped"})

        except Exception as exc:
            await send_json(ws, {"type": "error", "message": str(exc)})

async def main():
    global model
    print("Loading Pocket TTS locally...")
    print("This is the expensive step; it happens outside Chrome.")
    model = await asyncio.to_thread(lambda: TTSModel.load_model(language="english_2026-04", quantize=True))
    print(f"Pocket TTS loaded. Sample rate: {model.sample_rate}")
    print(f"Local WebSocket: ws://{HOST}:{PORT}")
    async with websockets.serve(handle, HOST, PORT, max_size=50 * 1024 * 1024):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
