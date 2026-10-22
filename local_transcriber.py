import os
import tempfile
from pathlib import Path
from flask import Flask, jsonify, request, make_response
from faster_whisper import WhisperModel

HOST, PORT = "127.0.0.1", 8178
MODEL_NAME = os.environ.get("WHISPER_MODEL", "small")
app = Flask(__name__)
print(f"Loading Faster-Whisper model '{MODEL_NAME}' (first run may download model files)...")
model = WhisperModel(MODEL_NAME, device="auto", compute_type="int8")
print(f"Local transcriber ready at http://{HOST}:{PORT}")

@app.after_request
def add_cors(response):
    origin = request.headers.get("Origin", "")
    if origin == "https://pocketweb.tools" or origin.startswith("chrome-extension://"):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

@app.route("/transcribe", methods=["POST", "OPTIONS"])
def transcribe():
    if request.method == "OPTIONS":
        return make_response("", 204)
    upload = request.files.get("file")
    if upload is None:
        return jsonify({"error": "Expected multipart field named 'file'."}), 400
    temp_path = None
    try:
        suffix = Path(upload.filename or "audio.webm").suffix or ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
            upload.save(temp)
            temp_path = temp.name
        segments, _ = model.transcribe(temp_path, vad_filter=True, beam_size=3)
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return jsonify({"text": text})
    except Exception as exc:
        app.logger.exception("Transcription failed")
        return jsonify({"error": str(exc)}), 500
    finally:
        if temp_path:
            try: os.remove(temp_path)
            except OSError: pass

if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
