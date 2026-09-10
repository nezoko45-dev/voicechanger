import base64
import json
import os
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
CONFIG_FILE = ROOT / "config.json"
HOST = "127.0.0.1"
PORT = 17856
BROWSER_ORIGIN = "http://127.0.0.1:17845"
RESEMBLE_SYNTH = "https://f.cluster.resemble.ai/synthesize"
RESEMBLE_STT = "https://app.resemble.ai/api/v2/speech-to-text"
RESEMBLE_VOICES = "https://app.resemble.ai/api/v2/voices"

running = False
status = "Stopped"
last_error = ""
last_duration = 0.0
last_text = ""


def load_config():
    defaults = {
        "api_key": "",
        "voice_uuid": "",
        "source_url": "",
        "pitch": 0.0,
        "prompt": "",
        "sample_rate": 48000,
        "output_format": "wav",
        "browser_output_device": "default",
    }
    if CONFIG_FILE.exists():
        try:
            defaults.update(json.loads(CONFIG_FILE.read_text(encoding="utf-8")))
        except Exception:
            pass
    return defaults


def save_config(config):
    CONFIG_FILE.write_text(json.dumps(config, indent=2), encoding="utf-8")


def set_status(value, error=""):
    global status, last_error
    status = value
    last_error = error
    print("[VoiceChanger] " + value + (": " + error if error else ""), flush=True)


def api_key(config):
    return str(config.get("api_key") or os.environ.get("RESEMBLE_API_KEY") or "").strip()


def request_json(url, key, payload=None, method="POST"):
    headers = {
        "Authorization": "Bearer " + key,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    data = None
    if method.upper() != "GET":
        data = json.dumps(payload or {}).encode("utf-8")
    else:
        headers.pop("Content-Type", None)
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Resemble HTTP {exc.code}: {detail[:1200]}")
    except urllib.error.URLError as exc:
        raise RuntimeError("Could not reach Resemble: " + str(exc.reason))


def multipart_body(file_name, file_data, content_type):
    boundary = "----VoiceChangerBoundary" + str(int(time.time() * 1000))
    body = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\n"
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8") + file_data + f"\r\n--{boundary}--\r\n".encode("utf-8")
    return boundary, body


def resemble_stt(audio_data, mime="audio/wav"):
    config = load_config()
    key = api_key(config)
    if not key:
        raise RuntimeError("Missing Resemble API key.")

    normalized_mime = str(mime or "audio/wav").split(";", 1)[0].strip().lower()
    extension = {
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/mp4": "m4a",
        "audio/mpeg": "mp3",
    }.get(normalized_mime, "wav")
    boundary, body = multipart_body(f"microphone.{extension}", audio_data, normalized_mime)
    req = urllib.request.Request(
        RESEMBLE_STT,
        data=body,
        method="POST",
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "multipart/form-data; boundary=" + boundary,
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Resemble STT HTTP {exc.code}: {detail[:1200]}")
    except urllib.error.URLError as exc:
        raise RuntimeError("Could not reach Resemble STT: " + str(exc.reason))

    if not result.get("success"):
        raise RuntimeError(str(result.get("error") or result.get("issues") or "Resemble STT failed"))

    job = result.get("item") or {}
    job_id = job.get("uuid")
    if not job_id:
        raise RuntimeError("Resemble STT returned no transcript UUID")

    for _ in range(120):
        time.sleep(0.25)
        status_result = request_json(
            f"https://app.resemble.ai/api/v2/speech-to-text/{job_id}",
            key,
            method="GET",
        )
        item = status_result.get("item") or {}
        state = str(item.get("status") or "").lower()
        if state in ("completed", "complete", "finished", "succeeded", "success"):
            text = str(item.get("text") or "").strip()
            if not text:
                raise RuntimeError("Resemble STT completed but returned no text")
            return text
        if state in ("failed", "error", "cancelled"):
            detail = item.get("error") or item.get("issues") or "Resemble STT job failed"
            raise RuntimeError(str(detail))

    raise RuntimeError("Resemble STT timed out after 30 seconds")


def resemble_tts(text, config):
    key = api_key(config)
    if not key:
        raise RuntimeError("Missing Resemble API key.")
    voice_uuid = str(config.get("voice_uuid") or "").strip()
    if not voice_uuid:
        raise RuntimeError("Select a Resemble custom voice first.")
    text = str(text or "").strip()
    if not text:
        raise RuntimeError("There is no text to synthesize.")
    if len(text) > 3000:
        text = text[:3000]
    data = text
    prompt = str(config.get("prompt") or "").strip()
    if prompt:
        data = f'<speak prompt="{prompt.replace(chr(34), chr(39))}">{text}</speak>'
    payload = {
        "voice_uuid": voice_uuid,
        "data": data,
        "sample_rate": int(config.get("sample_rate", 48000)),
        "output_format": "wav",
        "precision": "PCM_16",
    }
    result = request_json(RESEMBLE_SYNTH, key, payload, method="POST")
    if not result.get("success"):
        raise RuntimeError(str(result.get("issues") or result.get("error") or "Resemble TTS failed"))
    audio = result.get("audio_content")
    if not audio:
        raise RuntimeError("Resemble TTS returned no audio_content")
    try:
        audio_bytes = base64.b64decode(audio)
    except Exception as exc:
        raise RuntimeError("Resemble returned invalid base64 audio: " + str(exc))
    if not audio_bytes.startswith(b"RIFF") or b"WAVE" not in audio_bytes[:16]:
        raise RuntimeError("Resemble returned audio that is not a WAV file")
    duration = float(result.get("duration") or 0.0)
    return audio_bytes, duration


def list_voices():
    config = load_config()
    key = api_key(config)
    if not key:
        raise RuntimeError("Enter your Resemble API key first.")
    result = request_json(RESEMBLE_VOICES + "?page=1&page_size=100", key, method="GET")
    return result.get("items") or []


def audio_devices_note():
    return {
        "browser_managed": True,
        "message": "Audio playback is handled by the browser Audio API. Select the desired Windows output in the browser UI.",
    }


class Handler(BaseHTTPRequestHandler):
    def _json(self, value, code=200):
        body = json.dumps(value).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", BROWSER_ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Audio-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", BROWSER_ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Audio-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        config = load_config()
        if path == "/status":
            self._json({
                "running": running,
                "status": status,
                "error": last_error,
                "voice_uuid_set": bool(str(config.get("voice_uuid") or "").strip()),
                "duration": last_duration,
                "last_text": last_text,
                "browser_audio": True,
                "output_device": config.get("browser_output_device", "default"),
            })
            return
        if path == "/config":
            safe = dict(config)
            safe["api_key"] = "configured" if api_key(config) else ""
            self._json(safe)
            return
        if path == "/audio-devices":
            self._json(audio_devices_note())
            return
        if path == "/voices":
            try:
                self._json({"voices": list_voices()})
            except Exception as exc:
                self._json({"error": str(exc)}, 500)
            return
        self._json({"error": "Not found"}, 404)

    def do_POST(self):
        global running, last_duration, last_text
        path = urlparse(self.path).path
        if path in ("/stt-tts", "/tts"):
            try:
                config = load_config()
                started = time.perf_counter()
                if path == "/stt-tts":
                    length = int(self.headers.get("Content-Length", "0"))
                    audio = self.rfile.read(length)
                    if not audio:
                        raise RuntimeError("No microphone audio received")
                    mime = self.headers.get("X-Audio-Type") or self.headers.get("Content-Type") or "audio/wav"
                    set_status("Resemble STT: transcribing microphone…")
                    text = resemble_stt(audio, mime)
                else:
                    length = int(self.headers.get("Content-Length", "0"))
                    payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                    text = str(payload.get("text") or "").strip()
                    if not text:
                        raise RuntimeError("No test text supplied")
                set_status("Resemble Audio API: synthesizing WAV…")
                output, duration = resemble_tts(text, config)
                last_duration = duration
                last_text = text
                elapsed = time.perf_counter() - started
                encoded = base64.b64encode(output).decode("ascii")
                set_status("Audio ready — browser playback")
                self._json({
                    "ok": True,
                    "text": text,
                    "duration": duration,
                    "elapsed": elapsed,
                    "audio_base64": encoded,
                    "mime": "audio/wav",
                    "sample_rate": int(config.get("sample_rate", 48000)),
                    "output_device": config.get("browser_output_device", "default"),
                })
                return
            except Exception as exc:
                set_status("Error", str(exc))
                self._json({"error": str(exc)}, 500)
                return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except Exception:
            self._json({"error": "Invalid JSON"}, 400)
            return
        try:
            if path == "/config":
                config = load_config()
                allowed = ("api_key", "voice_uuid", "source_url", "pitch", "prompt", "sample_rate", "output_format", "browser_output_device")
                for key in allowed:
                    if key in payload:
                        config[key] = payload[key]
                save_config(config)
                self._json({"ok": True, **audio_devices_note()})
                return
            if path == "/start":
                config = load_config()
                if not api_key(config):
                    raise RuntimeError("Enter your Resemble API key first.")
                if not str(config.get("voice_uuid") or "").strip():
                    raise RuntimeError("Select a Resemble custom voice first.")
                running = True
                set_status("Resemble STT/TTS ready — browser audio enabled")
                self._json({"ok": True, "status": status})
                return
            if path == "/stop":
                running = False
                set_status("Stopped")
                self._json({"ok": True})
                return
            self._json({"error": "Not found"}, 404)
        except Exception as exc:
            set_status("Error", str(exc))
            self._json({"error": str(exc)}, 500)

    def log_message(self, format, *args):
        return


def main():
    set_status("Resemble Audio API bridge ready")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[VoiceChanger] browser bridge listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
