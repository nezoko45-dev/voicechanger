from pathlib import Path
import io
import os
import tempfile
import threading
import traceback

from flask import Flask, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parent
VOICE_DIR = ROOT / "voices"
VOICE_DIR.mkdir(exist_ok=True)
REFERENCE_WAV = VOICE_DIR / "reference.wav"

app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
TTS_MODEL_ID = os.getenv("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-Base")
WHISPER_MODEL_ID = os.getenv("WHISPER_MODEL", "small")

tts_model = None
whisper_model = None
voice_ready = False
model_lock = threading.Lock()
startup_error = None


def get_torch():
    import torch
    return torch


def get_tts():
    global tts_model, startup_error
    if tts_model is not None:
        return tts_model
    with model_lock:
        if tts_model is None:
            try:
                from qwen_tts import Qwen3TTSModel
                torch = get_torch()
                if torch.cuda.is_available():
                    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
                    device = "cuda:0"
                else:
                    dtype = torch.float32
                    device = "cpu"
                print(f"[TTS] Loading {TTS_MODEL_ID} on {device}...")
                tts_model = Qwen3TTSModel.from_pretrained(
                    TTS_MODEL_ID,
                    device_map=device,
                    dtype=dtype,
                )
                startup_error = None
            except Exception as exc:
                startup_error = f"TTS load failed: {type(exc).__name__}: {exc}"
                traceback.print_exc()
                raise
    return tts_model


def get_whisper():
    global whisper_model, startup_error
    if whisper_model is not None:
        return whisper_model
    with model_lock:
        if whisper_model is None:
            try:
                import torch
                from faster_whisper import WhisperModel
                device = "cuda" if torch.cuda.is_available() else "cpu"
                compute = "float16" if device == "cuda" else "int8"
                print(f"[STT] Loading faster-whisper {WHISPER_MODEL_ID} on {device}/{compute}...")
                whisper_model = WhisperModel(WHISPER_MODEL_ID, device=device, compute_type=compute)
                startup_error = None
            except Exception as exc:
                startup_error = f"STT load failed: {type(exc).__name__}: {exc}"
                traceback.print_exc()
                raise
    return whisper_model


@app.get("/")
def home():
    return send_from_directory(ROOT, "voicechanger.html")


@app.get("/api/status")
def status():
    try:
        import torch
        cuda = torch.cuda.is_available()
        torch_ok = True
    except Exception as exc:
        cuda = False
        torch_ok = False
        return jsonify({
            "ok": True,
            "server": True,
            "torch": False,
            "cuda": False,
            "tts": TTS_MODEL_ID,
            "stt": WHISPER_MODEL_ID,
            "voice_cloned": voice_ready and REFERENCE_WAV.exists(),
            "error": f"PyTorch import failed: {type(exc).__name__}: {exc}",
        })
    return jsonify({
        "ok": True,
        "server": True,
        "torch": torch_ok,
        "cuda": cuda,
        "tts": TTS_MODEL_ID,
        "stt": WHISPER_MODEL_ID,
        "voice_cloned": voice_ready and REFERENCE_WAV.exists(),
        "error": startup_error,
    })


@app.post("/api/clone")
def clone():
    global voice_ready, startup_error
    audio = request.files.get("audio")
    if audio is None or not audio.filename:
        return jsonify(error="Choose your WAV file first."), 400
    if Path(audio.filename).suffix.lower() != ".wav":
        return jsonify(error="Please select a .wav file."), 400

    temp_path = VOICE_DIR / "reference.upload.wav"
    try:
        audio.save(temp_path)
        if temp_path.stat().st_size < 1000:
            return jsonify(error="That WAV file is empty or too small."), 400

        # Keep the user's WAV exactly as supplied. Qwen3-TTS accepts a local WAV path.
        temp_path.replace(REFERENCE_WAV)
        model = get_tts()

        # Validate the reference now, but do not create/cache a prompt here.
        # Generation will use this same local WAV directly, which is more compatible
        # across qwen-tts package versions.
        model.create_voice_clone_prompt(
            ref_audio=str(REFERENCE_WAV),
            x_vector_only_mode=True,
        )
        voice_ready = True
        startup_error = None
        return jsonify(ok=True, message="Your WAV voice is ready. Click Speak to test it.")
    except Exception as exc:
        voice_ready = False
        startup_error = f"Voice clone failed: {type(exc).__name__}: {exc}"
        traceback.print_exc()
        return jsonify(error=startup_error), 500
    finally:
        try:
            if temp_path.exists():
                temp_path.unlink()
        except OSError:
            pass


@app.post("/api/tts")
def tts():
    if not voice_ready or not REFERENCE_WAV.exists():
        return jsonify(error="Select your WAV and click Use this WAV voice first."), 400
    text = (request.form.get("text") or "").strip()
    if not text:
        return jsonify(error="Text is required."), 400
    try:
        import soundfile as sf
        model = get_tts()
        # Pass the user's WAV directly. This avoids depending on a cached prompt
        # object format that differs between qwen-tts releases.
        wavs, sample_rate = model.generate_voice_clone(
            text=text[:500],
            language="English",
            ref_audio=str(REFERENCE_WAV),
            x_vector_only_mode=True,
        )
        out = io.BytesIO()
        sf.write(out, wavs[0], sample_rate, format="WAV", subtype="PCM_16")
        return app.response_class(out.getvalue(), mimetype="audio/wav")
    except Exception as exc:
        traceback.print_exc()
        return jsonify(error=f"TTS failed: {type(exc).__name__}: {exc}"), 500


@app.post("/api/stt")
def stt():
    audio = request.files.get("audio")
    if audio is None:
        return jsonify(error="Audio is required."), 400
    suffix = Path(audio.filename or "speech.webm").suffix or ".webm"
    fd, temp_name = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    try:
        audio.save(temp_name)
        model = get_whisper()
        segments, info = model.transcribe(
            temp_name,
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        text = " ".join(s.text.strip() for s in segments if s.text.strip()).strip()
        return jsonify(text=text, language=info.language)
    except Exception as exc:
        traceback.print_exc()
        return jsonify(error=f"STT failed: {type(exc).__name__}: {exc}"), 500
    finally:
        try:
            os.remove(temp_name)
        except OSError:
            pass


if __name__ == "__main__":
    print("VoiceChanger server: http://127.0.0.1:8765")
    print("Local-only mode: no Railway or cloud service is required.")
    app.run(host="127.0.0.1", port=8765, threaded=True)
