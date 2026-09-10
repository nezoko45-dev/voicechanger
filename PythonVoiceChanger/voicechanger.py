import base64
import io
import json
import os
import queue
import subprocess
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import requests
import sounddevice as sd

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
TARGET_WAV = REPO_ROOT / "ElevenLabs_2026-08-16T20_54_01_Ava – Natural AI Voice_pvc_sp100_s50_sb75_se36_b_e2.wav"
VOICE_ID_FILE = ROOT / "voice_id.txt"
CONFIG_FILE = ROOT / "config.json"
HOST = "127.0.0.1"
PORT = 17856
ELEVEN_BASE = "https://api.elevenlabs.io"

SAMPLE_RATE = 16000
CHANNELS = 1
CHUNK_MS = 1200
CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_MS // 1000

mic_queue: queue.Queue[bytes] = queue.Queue(maxsize=12)
audio_queue: queue.Queue[np.ndarray] = queue.Queue(maxsize=24)
running = False
worker_thread = None
stream = None
status = "Stopped"
last_error = ""


def load_config():
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "elevenlabs_api_key": "",
        "output_device": None,
        "voice_id": "",
    }


def save_config(config):
    CONFIG_FILE.write_text(json.dumps(config, indent=2), encoding="utf-8")


def get_voice_id(api_key: str) -> str:
    config = load_config()
    configured = str(config.get("voice_id") or "").strip()
    if configured:
        return configured
    if VOICE_ID_FILE.exists():
        saved = VOICE_ID_FILE.read_text(encoding="utf-8").strip()
        if saved:
            return saved
    if not TARGET_WAV.exists():
        raise FileNotFoundError(f"Target WAV not found: {TARGET_WAV}")

    # The WAV is used as a cloning sample. ElevenLabs Voice Changer itself
    # takes a voice_id as its target; it does not accept a local WAV as the
    # target voice directly.
    with TARGET_WAV.open("rb") as audio_file:
        response = requests.post(
            ELEVEN_BASE + "/v1/voices/add",
            headers={"xi-api-key": api_key},
            files={"files[]": (TARGET_WAV.name, audio_file, "audio/wav")},
            data={
                "name": "VoiceChanger repo target - Ava",
                "description": "Created from the repository target WAV for authorized voice conversion.",
            },
            timeout=90,
        )
    response.raise_for_status()
    voice_id = response.json()["voice_id"]
    VOICE_ID_FILE.write_text(voice_id, encoding="utf-8")
    config["voice_id"] = voice_id
    save_config(config)
    return voice_id


def set_status(value: str, error: str = ""):
    global status, last_error
    status = value
    last_error = error
    print(f"[VoiceChanger] {value}" + (f": {error}" if error else ""), flush=True)


def output_device():
    config = load_config()
    selected = config.get("output_device")
    if selected in (None, "", -1):
        return None
    return selected


def mic_callback(indata, frames, time_info, flags):
    if flags:
        print(f"[VoiceChanger] microphone flags: {flags}", flush=True)
    raw = np.asarray(indata[:, 0], dtype=np.int16).tobytes()
    try:
        mic_queue.put_nowait(raw)
    except queue.Full:
        try:
            mic_queue.get_nowait()
            mic_queue.put_nowait(raw)
        except queue.Empty:
            pass


def play_pcm16(data: bytes):
    pcm = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
    if pcm.size == 0:
        return
    # ElevenLabs may return another sample rate in unusual configurations.
    # Voice Changer output is requested at 48 kHz below, so play at 48 kHz.
    audio_queue.put(pcm)


def playback_worker():
    device = output_device()
    try:
        with sd.OutputStream(
            samplerate=48000,
            channels=1,
            dtype="float32",
            device=device,
            blocksize=960,
            latency="low",
        ) as out:
            set_status("LIVE — Python → ElevenLabs → selected Windows output")
            while running:
                try:
                    pcm = audio_queue.get(timeout=0.2)
                except queue.Empty:
                    continue
                # The stream is fed in small slices to keep latency bounded.
                pos = 0
                while pos < len(pcm) and running:
                    block = pcm[pos:pos + 960]
                    if len(block) < 960:
                        block = np.pad(block, (0, 960 - len(block)))
                    out.write(block.reshape(-1, 1))
                    pos += 960
    except Exception as exc:
        set_status("Output device error", str(exc))


def convert_worker(api_key: str, voice_id: str):
    global running
    while running:
        try:
            first = mic_queue.get(timeout=0.5)
        except queue.Empty:
            continue

        chunks = [first]
        total = len(first)
        # Build about 1.2 seconds of speech before each conversion request.
        while total < CHUNK_SAMPLES * 2 and running:
            try:
                part = mic_queue.get(timeout=0.15)
            except queue.Empty:
                break
            chunks.append(part)
            total += len(part) // 2

        audio = b"".join(chunks)
        files = {"audio": ("live.pcm", audio, "application/octet-stream")}
        data = {
            "model_id": "eleven_multilingual_sts_v2",
            "file_format": "pcm_s16le_16",
            "output_format": "pcm_48000",
            "remove_background_noise": "false",
        }
        try:
            response = requests.post(
                f"{ELEVEN_BASE}/v1/speech-to-speech/{voice_id}/stream",
                params={"output_format": "pcm_48000"},
                headers={"xi-api-key": api_key},
                files=files,
                data=data,
                stream=True,
                timeout=(10, 45),
            )
            response.raise_for_status()
            set_status("LIVE — converting microphone")
            for part in response.iter_content(chunk_size=9600):
                if part and running:
                    play_pcm16(part)
        except Exception as exc:
            set_status("Conversion error", str(exc))
            time.sleep(0.5)


def start_engine(api_key: str):
    global running, worker_thread, stream
    if running:
        return
    if not api_key:
        raise ValueError("Enter an ElevenLabs API key")
    voice_id = get_voice_id(api_key)
    running = True
    set_status("Starting microphone and target voice…")
    stream = sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="int16",
        blocksize=CHUNK_SAMPLES,
        latency="low",
        callback=mic_callback,
    )
    stream.start()
    worker_thread = threading.Thread(target=convert_worker, args=(api_key, voice_id), daemon=True)
    worker_thread.start()
    threading.Thread(target=playback_worker, daemon=True).start()


def stop_engine():
    global running, stream
    running = False
    if stream is not None:
        try:
            stream.stop()
            stream.close()
        except Exception:
            pass
        stream = None
    while True:
        try:
            mic_queue.get_nowait()
        except queue.Empty:
            break
    while True:
        try:
            audio_queue.get_nowait()
        except queue.Empty:
            break
    set_status("Stopped")


class Handler(BaseHTTPRequestHandler):
    def _json(self, value, code=200):
        body = json.dumps(value).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1:17845")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1:17845")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/status":
            config = load_config()
            self._json({
                "running": running,
                "status": status,
                "error": last_error,
                "voice_id": config.get("voice_id", ""),
                "target_wav": str(TARGET_WAV.name),
            })
            return
        if path == "/devices":
            try:
                devices = sd.query_devices()
                outputs = [
                    {"id": i, "name": d["name"], "hostapi": d["hostapi"]}
                    for i, d in enumerate(devices) if d["max_output_channels"] > 0
                ]
                self._json(outputs)
            except Exception as exc:
                self._json({"error": str(exc)}, 500)
            return
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        try:
            if path == "/start":
                api_key = str(payload.get("api_key", "")).strip()
                start_engine(api_key)
                self._json({"ok": True})
                return
            if path == "/stop":
                stop_engine()
                self._json({"ok": True})
                return
            if path == "/config":
                config = load_config()
                if "output_device" in payload:
                    config["output_device"] = payload["output_device"]
                save_config(config)
                self._json({"ok": True})
                return
            if path == "/clone":
                api_key = str(payload.get("api_key", "")).strip()
                if not api_key:
                    raise ValueError("Enter an ElevenLabs API key first")
                voice_id = get_voice_id(api_key)
                self._json({"ok": True, "voice_id": voice_id})
                return
            self._json({"error": "not found"}, 404)
        except Exception as exc:
            set_status("Error", str(exc))
            self._json({"ok": False, "error": str(exc)}, 500)

    def log_message(self, fmt, *args):
        return


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[VoiceChanger] Python audio engine listening on http://{HOST}:{PORT}", flush=True)
    print(f"[VoiceChanger] Target WAV: {TARGET_WAV}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_engine()
        server.server_close()


if __name__ == "__main__":
    main()
