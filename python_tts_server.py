from __future__ import annotations

import os
import tempfile
from pathlib import Path

import torch
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from faster_whisper import WhisperModel
from TTS.api import TTS

# PyTorch-powered local speech pipeline:
# WAV -> Faster-Whisper transcription -> XTTS-v2 synthesis using the uploaded
# WAV as the speaker reference. No Deepgram or Flux voice is used.
HOST = os.getenv("PYTHON_TTS_HOST", "127.0.0.1")
PORT = int(os.getenv("PYTHON_TTS_PORT", "8787"))

# Prefer CUDA when PyTorch detects an NVIDIA GPU; otherwise use CPU.
DEVICE = os.getenv("PYTHON_TTS_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")
COMPUTE_TYPE = os.getenv(
    "PYTHON_TTS_COMPUTE_TYPE",
    "float16" if DEVICE.startswith("cuda") else "int8",
)
WHISPER_SIZE = os.getenv("WHISPER_MODEL", "small")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

whisper = None
tts = None


def load_models() -> None:
    global whisper, tts

    if whisper is None:
        print(f"Loading Faster-Whisper ({WHISPER_SIZE}) on {DEVICE}...")
        whisper = WhisperModel(
            WHISPER_SIZE,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
        )

    if tts is None:
        print(f"Loading XTTS-v2 through PyTorch on {DEVICE}...")
        tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(DEVICE)


def transcribe(path: str) -> str:
    segments, _ = whisper.transcribe(path, vad_filter=True)
    return " ".join(segment.text.strip() for segment in segments).strip()


@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "pytorch": torch.__version__,
        "cuda": torch.cuda.is_available(),
        "device": DEVICE,
        "whisper": WHISPER_SIZE,
        "tts": "xtts_v2",
    })


@app.post("/synthesize")
def synthesize():
    uploaded = request.files.get("wav")
    if uploaded is None:
        return jsonify({"error": "Choose a WAV file."}), 400

    if not uploaded.filename or not uploaded.filename.lower().endswith(".wav"):
        return jsonify({"error": "Only .wav files are supported."}), 400

    with tempfile.TemporaryDirectory(prefix="voicechanger_") as directory:
        source = Path(directory) / "source.wav"
        output = Path(directory) / "synthesized.wav"
        uploaded.save(source)

        if source.stat().st_size > 50 * 1024 * 1024:
            return jsonify({"error": "WAV file is too large (50 MB maximum)."}), 413

        try:
            load_models()

            text = transcribe(str(source))
            if not text:
                return jsonify({"error": "No speech was detected in the WAV file."}), 422

            # XTTS-v2 creates new speech from the transcript while conditioning
            # on the uploaded WAV as the speaker reference.
            tts.tts_to_file(
                text=text,
                speaker_wav=str(source),
                language="en",
                file_path=str(output),
            )

            response = send_file(
                str(output),
                mimetype="audio/wav",
                as_attachment=False,
            )
            response.headers["X-Transcript"] = text[:4000]
            response.headers["Cache-Control"] = "no-store"
            return response
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    print("========================================")
    print(" VoiceChanger - PyTorch WAV Synthesis")
    print("========================================")
    print(f"PyTorch: {torch.__version__}")
    print(f"CUDA available: {torch.cuda.is_available()}")
    print(f"Device: {DEVICE}")
    print(f"Whisper: {WHISPER_SIZE}")
    print(f"Listening on http://{HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False)
