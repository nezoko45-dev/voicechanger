#!/usr/bin/env python3
"""Local-only Whisper transcription endpoint for ChatGPT Echo Guard."""
import base64
import io
import json
import os
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from faster_whisper import WhisperModel

HOST = "127.0.0.1"
PORT = 8765
MODEL_NAME = os.environ.get("ECHO_GUARD_MODEL", "base.en")
print(f"Loading Whisper model {MODEL_NAME!r}; first run downloads it once...", flush=True)
model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")

class Handler(BaseHTTPRequestHandler):
    def _headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        # Localhost-only API; Chrome extension origin is validated by binding to loopback.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_OPTIONS(self):
        self._headers(204)

    def do_POST(self):
        if self.path != "/transcribe":
            self._headers(404); self.wfile.write(b'{"error":"not found"}'); return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 30_000_000:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(length))
            raw = base64.b64decode(payload["audio"], validate=True)
            with wave.open(io.BytesIO(raw), "rb") as wav:
                if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
                    raise ValueError("expected mono 16-bit PCM WAV")
                rate = wav.getframerate()
                audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
            if len(audio) < rate // 3:
                raise ValueError("audio clip too short")
            segments, _ = model.transcribe(audio, language="en", beam_size=1, vad_filter=False, condition_on_previous_text=False)
            text = " ".join(segment.text.strip() for segment in segments).strip()
            self._headers()
            self.wfile.write(json.dumps({"text": text}).encode())
        except Exception as exc:
            self._headers(400)
            self.wfile.write(json.dumps({"error": str(exc)}).encode())

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

if __name__ == "__main__":
    print(f"Echo Guard local Whisper listening only on http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
