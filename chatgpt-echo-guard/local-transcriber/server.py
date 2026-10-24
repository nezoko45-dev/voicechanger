#!/usr/bin/env python3
"""Local-only transcription and echo comparison service for ChatGPT Echo Guard."""
import base64
import io
import json
import os
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from faster_whisper import WhisperModel

HOST = "127.0.0.1"
PORT = 8765
MODEL_NAME = os.environ.get("ECHO_GUARD_MODEL", "base.en")
print(f"Loading Whisper model {MODEL_NAME!r}; first run downloads it once...", flush=True)
model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
state_lock = threading.Lock()
last_user_text = ""
last_user_at = 0.0


def transcribe_wav(raw):
    with wave.open(io.BytesIO(raw), "rb") as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise ValueError("expected mono 16-bit PCM WAV")
        rate = wav.getframerate()
        audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    if rate != 16000:
        raise ValueError("expected 16 kHz WAV audio")
    if len(audio) < rate // 3:
        raise ValueError("audio clip too short")
    segments, _ = model.transcribe(
        audio, language="en", beam_size=1, vad_filter=False,
        condition_on_previous_text=False
    )
    return " ".join(segment.text.strip() for segment in segments).strip()


def normalize(value):
    import re
    value = str(value or "").lower().replace("’", "").replace("'", "")
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


class Handler(BaseHTTPRequestHandler):
    def _headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        origin = self.headers.get("Origin", "")
        if origin.startswith("chrome-extension://"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path in ("/", "/health"):
            self._headers(200)
            self.wfile.write(json.dumps({
                "ok": True,
                "service": "ChatGPT Echo Guard local transcriber",
                "model": MODEL_NAME,
                "endpoint": "POST /transcribe",
                "note": "Open this page to check service status; audio transcription is available only to the Chrome extension."
            }).encode("utf-8"))
            return
        self._headers(404)
        self.wfile.write(b'{"error":"not found"}')

    def do_OPTIONS(self):
        if not self.headers.get("Origin", "").startswith("chrome-extension://"):
            self._headers(403)
            return
        self._headers(204)

    def do_POST(self):
        global last_user_text, last_user_at
        if not self.headers.get("Origin", "").startswith("chrome-extension://"):
            self._headers(403)
            self.wfile.write(b'{"error":"extension origin required"}')
            return
        if self.path != "/transcribe":
            self._headers(404)
            self.wfile.write(b'{"error":"not found"}')
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 30000000:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(length))
            role = payload.get("role")
            if role not in ("user", "assistant"):
                raise ValueError("role must be user or assistant")
            raw = base64.b64decode(payload["audio"], validate=True)
            text = transcribe_wav(raw)
            normalized = normalize(text)
            result = {"text": text, "role": role, "status": "waiting"}

            if normalized:
                with state_lock:
                    now = time.monotonic()
                    if role == "user":
                        last_user_text = normalized
                        last_user_at = now
                        result.update({"status": "user-heard", "user": text})
                    else:
                        result["assistant"] = text
                        if not last_user_text or now - last_user_at > 45:
                            result["status"] = "waiting"
                        else:
                            same = normalized == last_user_text
                            result.update({
                                "status": "match" if same else "mismatch",
                                "user": last_user_text,
                                "assistant": normalized
                            })
                            last_user_text = ""
                            last_user_at = 0.0

            self._headers()
            self.wfile.write(json.dumps(result).encode("utf-8"))
        except Exception as exc:
            print(f"Transcription request rejected: {type(exc).__name__}: {exc}", flush=True)
            self._headers(400)
            self.wfile.write(json.dumps({"error": str(exc)}).encode("utf-8"))

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    print(f"Echo Guard local audio comparison listening on http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
