from flask import Flask, request, jsonify
from faster_whisper import WhisperModel
import os, tempfile, threading

app = Flask(__name__)
MODEL_NAME = os.environ.get("WHISPER_MODEL", "base.en")
_model = None
_lock = threading.Lock()

def model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                print(f"Loading Whisper model {MODEL_NAME} locally…", flush=True)
                _model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
                print("Local Whisper is ready.", flush=True)
    return _model

@app.after_request
def cors(response):
    origin = request.headers.get("Origin", "")
    if origin == "https://character.ai" or origin.endswith(".character.ai"):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

@app.route("/health", methods=["GET", "OPTIONS"])
def health():
    if request.method == "OPTIONS": return "", 204
    return jsonify({"ok": True, "model": MODEL_NAME, "loaded": _model is not None})

@app.route("/transcribe", methods=["POST", "OPTIONS"])
def transcribe():
    if request.method == "OPTIONS": return "", 204
    if request.remote_addr not in ("127.0.0.1", "::1"):
        return jsonify({"error": "Loopback requests only"}), 403
    upload = request.files.get("audio")
    if not upload: return jsonify({"error": "Missing audio"}), 400
    path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            path = f.name
            upload.save(path)
        segments, _ = model().transcribe(path, language="en", vad_filter=True, beam_size=1)
        return jsonify({"text": " ".join(s.text.strip() for s in segments).strip()})
    except Exception as exc:
        app.logger.exception("Transcription failed")
        return jsonify({"error": str(exc)}), 500
    finally:
        if path and os.path.exists(path): os.remove(path)

if __name__ == "__main__":
    print("Local Whisper API at http://127.0.0.1:8765 (loopback only)", flush=True)
    print("First run downloads the model; later runs use its local cache.", flush=True)
    model()
    app.run(host="127.0.0.1", port=8765, threaded=True, debug=False)
