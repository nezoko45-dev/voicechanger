import base64
import ctypes
import ctypes.wintypes as wintypes
import json
import os
import time
import urllib.error
import urllib.request
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

# Resemble speech-to-speech bridge.
# The local browser talks to this process; the process talks directly to
# Resemble's synthesis endpoint. No third-party Python packages are required.
# IMPORTANT: Resemble STS currently expects the donor WAV as a public HTTPS URL.

ROOT = Path(__file__).resolve().parent
CONFIG_FILE = ROOT / "config.json"
HOST = "127.0.0.1"
PORT = 17856
BROWSER_ORIGIN = "http://127.0.0.1:17845"
RESEMBLE_SYNTH = "https://f.cluster.resemble.ai/synthesize"

running = False
status = "Stopped"
last_error = ""
last_duration = 0.0


def load_config():
    defaults = {
        "api_key": "",
        "voice_uuid": "",
        "source_url": "",
        "pitch": 0.0,
        "prompt": "",
        "sample_rate": 48000,
        "output_format": "wav",
    }
    if CONFIG_FILE.exists():
        try:
            value = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            defaults.update(value)
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


def build_ssml(source_url, pitch, prompt):
    # Escape values because they are inserted into an XML attribute.
    import html
    src = html.escape(str(source_url), quote=True)
    attrs = [f'src="{src}"']
    try:
        pitch_value = float(pitch)
    except Exception:
        pitch_value = 0.0
    pitch_value = max(-10.0, min(10.0, pitch_value))
    if pitch_value:
        attrs.append(f'pitch="{pitch_value:g}"')
    if prompt:
        attrs.append(f'prompt="{html.escape(str(prompt), quote=True)}"')
    return "<speak><resemble:convert " + " ".join(attrs) + "></resemble:convert></speak>"


def resemble_convert(config):
    key = api_key(config)
    voice_uuid = str(config.get("voice_uuid") or "").strip()
    source_url = str(config.get("source_url") or "").strip()
    if not key:
        raise RuntimeError("Missing Resemble API key. Enter it in the browser panel or set RESEMBLE_API_KEY.")
    if not voice_uuid:
        raise RuntimeError("Missing Resemble voice UUID.")
    if not source_url.lower().startswith("https://"):
        raise RuntimeError("Source WAV URL must be a public HTTPS URL that Resemble can reach.")

    payload = {
        "voice_uuid": voice_uuid,
        "data": build_ssml(source_url, config.get("pitch", 0), config.get("prompt", "")),
        "sample_rate": int(config.get("sample_rate", 48000)),
        "output_format": "wav",
        "precision": "PCM_16",
    }
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        RESEMBLE_SYNTH,
        data=body,
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Resemble HTTP {exc.code}: {detail[:1200]}")
    except urllib.error.URLError as exc:
        raise RuntimeError("Could not reach Resemble: " + str(exc.reason))

    try:
        result = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise RuntimeError("Resemble returned invalid JSON: " + str(exc))
    if not result.get("success"):
        raise RuntimeError(str(result.get("issues") or result.get("error") or "Resemble conversion failed"))
    audio = result.get("audio_content")
    if not audio:
        raise RuntimeError("Resemble returned no audio_content")
    return base64.b64decode(audio), float(result.get("duration") or 0.0)


def parse_wav(data):
    import io
    with wave.open(io.BytesIO(data), "rb") as wf:
        channels = wf.getnchannels()
        width = wf.getsampwidth()
        rate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())
    if channels != 1 or width != 2:
        raise RuntimeError("Resemble output must be mono 16-bit WAV for the Windows output bridge.")
    return rate, frames


winmm = ctypes.WinDLL("winmm.dll")

class WAVEFORMATEX(ctypes.Structure):
    _fields_ = [
        ("wFormatTag", wintypes.WORD),
        ("nChannels", wintypes.WORD),
        ("nSamplesPerSec", wintypes.DWORD),
        ("nAvgBytesPerSec", wintypes.DWORD),
        ("nBlockAlign", wintypes.WORD),
        ("wBitsPerSample", wintypes.WORD),
        ("cbSize", wintypes.WORD),
    ]

class WAVEHDR(ctypes.Structure):
    _fields_ = [
        ("lpData", ctypes.POINTER(ctypes.c_char)),
        ("dwBufferLength", wintypes.DWORD),
        ("dwBytesRecorded", wintypes.DWORD),
        ("dwUser", ctypes.c_size_t),
        ("dwFlags", wintypes.DWORD),
        ("dwLoops", wintypes.DWORD),
        ("lpNext", ctypes.c_void_p),
        ("reserved", ctypes.c_size_t),
    ]

HWAVEOUT = wintypes.HANDLE
WAVE_MAPPER = 0xFFFFFFFF
WHDR_DONE = 0x00000001

winmm.waveOutOpen.argtypes = [ctypes.POINTER(HWAVEOUT), wintypes.UINT, ctypes.POINTER(WAVEFORMATEX), ctypes.c_size_t, ctypes.c_size_t, wintypes.DWORD]
winmm.waveOutPrepareHeader.argtypes = [HWAVEOUT, ctypes.POINTER(WAVEHDR), wintypes.UINT]
winmm.waveOutWrite.argtypes = [HWAVEOUT, ctypes.POINTER(WAVEHDR), wintypes.UINT]
winmm.waveOutUnprepareHeader.argtypes = [HWAVEOUT, ctypes.POINTER(WAVEHDR), wintypes.UINT]
winmm.waveOutReset.argtypes = [HWAVEOUT]
winmm.waveOutClose.argtypes = [HWAVEOUT]


def play_wav(data):
    rate, pcm = parse_wav(data)
    fmt = WAVEFORMATEX(1, 1, rate, rate * 2, 2, 16, 0)
    handle = HWAVEOUT()
    result = winmm.waveOutOpen(ctypes.byref(handle), WAVE_MAPPER, ctypes.byref(fmt), 0, 0, 0)
    if result:
        raise RuntimeError("Windows audio output open failed: %s" % result)
    try:
        buffer = ctypes.create_string_buffer(pcm)
        hdr = WAVEHDR(ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)), len(pcm), 0, 0, 0, 0, None, 0)
        result = winmm.waveOutPrepareHeader(handle, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))
        if result:
            raise RuntimeError("Windows audio output prepare failed: %s" % result)
        result = winmm.waveOutWrite(handle, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))
        if result:
            raise RuntimeError("Windows audio output write failed: %s" % result)
        while running and not (hdr.dwFlags & WHDR_DONE):
            time.sleep(0.01)
        winmm.waveOutUnprepareHeader(handle, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))
    finally:
        winmm.waveOutReset(handle)
        winmm.waveOutClose(handle)


def start_engine():
    global running
    if running:
        return
    config = load_config()
    if not api_key(config):
        raise RuntimeError("Enter your Resemble API key first.")
    if not str(config.get("voice_uuid") or "").strip():
        raise RuntimeError("Enter your Resemble target voice UUID first.")
    if not str(config.get("source_url") or "").strip():
        raise RuntimeError("Enter a public HTTPS WAV source URL first.")
    running = True
    set_status("Resemble ready — press Convert to process the source WAV")


def stop_engine():
    global running
    running = False
    set_status("Stopped")


class Handler(BaseHTTPRequestHandler):
    def _json(self, value, code=200):
        body = json.dumps(value).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", BROWSER_ORIGIN)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", BROWSER_ORIGIN)
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
                "voice_uuid_set": bool(str(config.get("voice_uuid") or "").strip()),
                "source_url": config.get("source_url", ""),
                "duration": last_duration,
            })
            return
        if path == "/config":
            config = load_config()
            safe = dict(config)
            safe["api_key"] = "" if not api_key(config) else "configured"
            self._json(safe)
            return
        self._json({"error": "Not found"}, 404)

    def do_POST(self):
        global last_duration
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except Exception:
            self._json({"error": "Invalid JSON"}, 400)
            return

        try:
            if path == "/config":
                config = load_config()
                for key in ("api_key", "voice_uuid", "source_url", "pitch", "prompt", "sample_rate"):
                    if key in payload:
                        config[key] = payload[key]
                if payload.get("api_key") == "configured":
                    pass
                save_config(config)
                self._json({"ok": True})
                return
            if path == "/start":
                start_engine()
                self._json({"ok": True, "status": status})
                return
            if path == "/stop":
                stop_engine()
                self._json({"ok": True})
                return
            if path == "/convert":
                if not running:
                    start_engine()
                config = load_config()
                if payload:
                    config.update({k: payload[k] for k in ("source_url", "pitch", "prompt") if k in payload})
                    save_config(config)
                set_status("Sending WAV to Resemble…")
                started = time.perf_counter()
                audio, duration = resemble_convert(config)
                last_duration = duration
                set_status("Resemble conversion complete — playing output")
                play_wav(audio)
                elapsed = time.perf_counter() - started
                set_status("Complete — %.2fs conversion request" % elapsed)
                self._json({"ok": True, "duration": duration, "elapsed": elapsed})
                return
            self._json({"error": "Not found"}, 404)
        except Exception as exc:
            set_status("Error", str(exc))
            self._json({"error": str(exc), "status": status}, 500)

    def log_message(self, format, *args):
        return


def main():
    set_status("Resemble STS engine ready")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("[VoiceChanger] Resemble browser bridge listening on http://%s:%d" % (HOST, PORT), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
