from pathlib import Path
import io
import os
import tempfile
import threading

import numpy as np
import soundfile as sf
import torch
from flask import Flask, jsonify, request, send_from_directory
from faster_whisper import WhisperModel
from qwen_tts import Qwen3TTSModel

ROOT = Path(__file__).resolve().parent
VOICE_DIR = ROOT / "local_voices"
VOICE_DIR.mkdir(exist_ok=True)

app = Flask(__name__, static_folder=str(ROOT), static_url_path="")

# Smaller 0.6B Base model keeps local hardware requirements lower while still
# supporting Qwen3-TTS voice cloning.
TTS_MODEL_ID = os.getenv("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-Base")
WHISPER_MODEL_ID = os.getenv("WHISPER_MODEL", "small")

_tts = None
_whisper = None
_voice_prompt = None
_voice_lock = threading.Lock()


def load_tts():
    global _tts
    if _tts is not None:
        return _tts
    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device.startswith("cuda") and torch.cuda.is_bf16_supported() else torch.float16 if device.startswith("cuda") else torch.float32
    kwargs = {"device_map": device, "dtype": dtype}
    print(f"Loading Qwen3-TTS {TTS_MODEL_ID} on {device}...")
    _tts = Qwen3TTSModel.from_pretrained(TTS_MODEL_ID, **kwargs)
    return _tts


def load_whisper():
    global _whisper
    if _whisper is not None:
        return _whisper
    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute = "float16" if device == "cuda" else "int8"
    print(f"Loading faster-whisper {WHISPER_MODEL_ID} on {device}/{compute}...")
    _whisper = WhisperModel(WHISPER_MODEL_ID, device=device, compute_type=compute)
    return _whisper


@app.get("/")
def index():
    return send_from_directory(ROOT, "voicechanger.html")


@app.get("/api/status")
def status():
    return jsonify({
        "tts_model": TTS_MODEL_ID,
        "whisper_model": WHISPER_MODEL_ID,
        "cuda": torch.cuda.is_available(),
        "voice_cloned": _voice_prompt is not None,
    })


@app.post("/api/clone")
def clone():
    global _voice_prompt
    upload = request.files.get("audio")
    if upload is None:
        return jsonify({"error": "Upload a WAV voice sample."}), 400
    suffix = Path(upload.filename or "voice.wav").suffix.lower() or ".wav"
    if suffix != ".wav":
        return jsonify({"error": "Use a WAV reference recording."}), 400
    path = VOICE_DIR / "reference.wav"
    upload.save(path)
    try:
        model = load_tts()
        # x-vector mode needs only the reference speaker embedding, so the user
        # does not have to provide a transcript of the reference recording.
        prompt = model.create_voice_clone_prompt(
            ref_audio=str(path),
            x_vector_only_mode=True,
        )
        with _voice_lock:
            _voice_prompt = prompt
        return jsonify({"ok": True, "message": "Local Qwen voice clone is ready."})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/tts")
def tts():
    text = (request.form.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Text is required."}), 400
    with _voice_lock:
        prompt = _voice_prompt
    if prompt is None:
        return jsonify({"error": "Clone a voice first."}), 400
    try:
        model = load_tts()
        wavs, sr = model.generate_voice_clone(
            text=text[:500],
            language="English",
            voice_clone_prompt=prompt,
            x_vector_only_mode=True,
        )
        buf = io.BytesIO()
        sf.write(buf, wavs[0], sr, format="WAV", subtype="PCM_16")
        buf.seek(0)
        return app.response_class(buf.read(), mimetype="audio/wav")
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/stt")
def stt():
    upload = request.files.get("audio")
    if upload is None:
        return jsonify({"error": "Audio is required."}), 400
    suffix = Path(upload.filename or "speech.webm").suffix or ".webm"
    fd, name = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    try:
        upload.save(name)
        model = load_whisper()
        segments, info = model.transcribe(
            name,
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        text = " ".join(s.text.strip() for s in segments if s.text.strip()).strip()
        return jsonify({"text": text, "language": info.language})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        try:
            os.remove(name)
        except OSError:
            pass


if __name__ == "__main__":
    print("VoiceChanger local AI server: http://127.0.0.1:8765")
    app.run(host="127.0.0.1", port=8765, threaded=True)
