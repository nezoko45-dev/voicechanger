import asyncio
import io
import json
import os
import tempfile
import wave
from pathlib import Path

import numpy as np
import speech_recognition as sr
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

APP_DIR = Path(__file__).resolve().parent
REFERENCE_WAV = APP_DIR / "ElevenLabs_2026-08-16T20_54_01_Ava – Natural AI Voice_pvc_sp100_s50_sb75_se36_b_e2.wav"
OUTPUT_DIR = APP_DIR / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="VoiceChanger OpenVoice Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

recognizer = sr.Recognizer()
_openvoice = None


def pcm_to_wav(pcm: bytes, sample_rate: int = 16000) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return out.getvalue()


def transcribe_pcm(pcm: bytes) -> str:
    wav = pcm_to_wav(pcm)
    with sr.AudioFile(io.BytesIO(wav)) as source:
        audio = recognizer.record(source)
    try:
        return recognizer.recognize_google(audio, language="en-US").strip()
    except sr.UnknownValueError:
        return ""
    except sr.RequestError as exc:
        raise RuntimeError(f"SpeechRecognition service error: {exc}") from exc


def load_openvoice():
    global _openvoice
    if _openvoice is not None:
        return _openvoice

    from openvoice import se_extractor
    from openvoice.api import ToneColorConverter
    from melo.api import TTS

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    converter_dir = os.getenv("OPENVOICE_CONVERTER", "checkpoints_v2/converter")
    converter = ToneColorConverter(f"{converter_dir}/config.json", device=device)
    converter.load_ckpt(f"{converter_dir}/checkpoint.pth")

    if not REFERENCE_WAV.exists():
        raise FileNotFoundError(f"Reference WAV not found: {REFERENCE_WAV.name}")

    target_se, _ = se_extractor.get_se(str(REFERENCE_WAV), converter, vad=True)
    language = os.getenv("OPENVOICE_LANGUAGE", "EN_NEWEST")
    model = TTS(language=language, device=device)
    speaker_id = next(iter(model.hps.data.spk2id.values()))
    source_se_path = os.getenv(
        "OPENVOICE_SOURCE_SE",
        "checkpoints_v2/base_speakers/ses/en-newest.pth",
    )
    source_se = torch.load(source_se_path, map_location=device)

    _openvoice = (converter, target_se, model, speaker_id, source_se, device)
    return _openvoice


def synthesize(text: str) -> bytes:
    converter, target_se, model, speaker_id, source_se, device = load_openvoice()
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False, dir=OUTPUT_DIR) as src_file:
        src_path = Path(src_file.name)
    out_path = src_path.with_name(src_path.stem + "_cloned.wav")
    try:
        model.tts_to_file(text, speaker_id, str(src_path), speed=1.0)
        converter.convert(
            audio_src_path=str(src_path),
            src_se=source_se,
            tgt_se=target_se,
            output_path=str(out_path),
            message="@VoiceChanger",
        )
        return out_path.read_bytes()
    finally:
        src_path.unlink(missing_ok=True)
        out_path.unlink(missing_ok=True)


@app.get("/")
def index():
    return FileResponse(APP_DIR / "index.html")


@app.get("/health")
def health():
    return {"ok": True, "reference_wav": REFERENCE_WAV.exists(), "cuda": torch.cuda.is_available()}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    pcm_buffer = bytearray()
    chunk_bytes = 16000 * 2 * 2  # about 2 seconds at 16 kHz mono 16-bit
    try:
        await ws.send_text(json.dumps({"type": "status", "message": "🟢 Python backend connected."}))
        while True:
            data = await ws.receive()
            if "bytes" in data and data["bytes"] is not None:
                pcm_buffer.extend(data["bytes"])
                if len(pcm_buffer) >= chunk_bytes:
                    chunk = bytes(pcm_buffer[:chunk_bytes])
                    del pcm_buffer[:chunk_bytes]
                    try:
                        text = await asyncio.to_thread(transcribe_pcm, chunk)
                        if text:
                            await ws.send_text(json.dumps({"type": "transcript", "text": text}))
                            await ws.send_text(json.dumps({"type": "status", "message": "🧠 Generating OpenVoice speech…"}))
                            audio = await asyncio.to_thread(synthesize, text)
                            await ws.send_bytes(audio)
                    except Exception as exc:
                        await ws.send_text(json.dumps({"type": "error", "message": str(exc)}))
            elif "text" in data and data["text"]:
                message = json.loads(data["text"])
                if message.get("type") == "stop":
                    break
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass
