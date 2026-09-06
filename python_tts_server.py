from __future__ import annotations

import os
import tempfile
from pathlib import Path

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

# Local neural speech pipeline:
# WAV -> Faster-Whisper transcription -> XTTS-v2 synthesis using the uploaded
# WAV as the speaker reference. No Deepgram or Flux voice is used.
from faster_whisper import WhisperModel
from TTS.api import TTS

HOST = os.getenv("PYTHON_TTS_HOST", "127.0.0.1")
PORT = int(os.getenv("PYTHON_TTS_PORT", "8787"))
DEVICE = os.getenv("PYTHON_TTS_DEVICE", "cuda")
COMPUTE_TYPE = os.getenv(
    "PYTHON_TTS_COMPUTE_TYPE",
    "float16" if DEVICE.startswith("cuda") else "int8",
)
WHISPER_SIZE = os.getenv("WHISPER_MODEL", "small")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

whisper = None
tts = None


def load_models():
    global whisper, tts
    if whisper is None:
        whisper = WhisperModel(
            WHISPER_SIZE,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
        )
    if tts is None:
        tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(DEVICE)


def transcribe(path: str) -> str:
    segments, _ = whisper.transcribe(path, vad_filter=True)
    return " ".join(segment.text.strip() for segment in segments).strip()


@app.get("/health")
def health():
    return jsonify({
        "ok": True,
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

    with tempfile.TemporaryDirectory(prefix="uwu_tts_") as directory:
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

            # XTTS regenerates the transcript as new speech while using the
            # uploaded WAV as the speaker reference. The source recording is
            # not simply replayed.
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
    print(" Python WAV -> STT -> XTTS-v2 server")
    print("========================================")
    print(f"Device: {DEVICE}")
    print(f"Whisper: {WHISPER_SIZE}")
    print(f"Listening on http://{HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False)
