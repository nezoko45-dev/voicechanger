import ctypes
import ctypes.wintypes as wintypes
import json
import queue
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

# Windows-only, standard-library-only audio engine.
# No pip audio libraries, no NumPy, no Requests, no SoundDevice.

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
BITS = 16
CHUNK_MS = 1200
CHUNK_BYTES = SAMPLE_RATE * CHUNK_MS // 1000 * 2

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

HWAVEIN = wintypes.HANDLE
HWAVEOUT = wintypes.HANDLE
WAVE_MAPPER = 0xFFFFFFFF
CALLBACK_FUNCTION = 0x00030000
WIM_DATA = 0x3C0
WHDR_DONE = 0x00000001
WOM_DONE = 0x3BD

winmm.waveInOpen.argtypes = [ctypes.POINTER(HWAVEIN), wintypes.UINT, ctypes.POINTER(WAVEFORMATEX), ctypes.c_size_t, ctypes.c_size_t, wintypes.DWORD]
winmm.waveInPrepareHeader.argtypes = [HWAVEIN, ctypes.POINTER(WAVEHDR), wintypes.UINT]
winmm.waveInAddBuffer.argtypes = [HWAVEIN, ctypes.POINTER(WAVEHDR), wintypes.UINT]
winmm.waveInStart.argtypes = [HWAVEIN]
winmm.waveInStop.argtypes = [HWAVEIN]
winmm.waveInReset.argtypes = [HWAVEIN]
winmm.waveInUnprepareHeader.argtypes = [HWAVEIN, ctypes.POINTER(WAVEHDR), wintypes.UINT]
winmm.waveInClose.argtypes = [HWAVEIN]

winmm.waveOutOpen.argtypes = [ctypes.POINTER(HWAVEOUT), wintypes.UINT, ctypes.POINTER(WAVEFORMATEX), ctypes.c_size_t, ctypes.c_size_t, wintypes.DWORD]
winmm.waveOutPrepareHeader.argtypes = [HWAVEOUT, ctypes.POINTER(WAVEHDR), wintypes.UINT]
winmm.waveOutWrite.argtypes = [HWAVEOUT, ctypes.POINTER(WAVEHDR), wintypes.UINT]
winmm.waveOutUnprepareHeader.argtypes = [HWAVEOUT, ctypes.POINTER(WAVEHDR), wintypes.UINT]
winmm.waveOutReset.argtypes = [HWAVEOUT]
winmm.waveOutClose.argtypes = [HWAVEOUT]

mic_queue = queue.Queue(maxsize=8)
running = False
worker_thread = None
capture_handle = None
play_handle = None
status = "Stopped"
last_error = ""


def load_config():
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"elevenlabs_api_key": "", "voice_id": "", "output_device": None}


def save_config(config):
    CONFIG_FILE.write_text(json.dumps(config, indent=2), encoding="utf-8")


def set_status(value, error=""):
    global status, last_error
    status = value
    last_error = error
    print("[VoiceChanger] " + value + (": " + error if error else ""), flush=True)


def multipart(fields, file_field, filename, data, content_type="audio/wav"):
    boundary = "----VoiceChangerBoundary7MA4YWxkTrZu0gW"
    body = bytearray()
    for name, value in fields.items():
        body.extend(("--" + boundary + "\r\n").encode())
        body.extend((f'Content-Disposition: form-data; name="{name}"\r\n\r\n').encode())
        body.extend(str(value).encode())
        body.extend(b"\r\n")
    body.extend(("--" + boundary + "\r\n").encode())
    body.extend((f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n').encode())
    body.extend((f"Content-Type: {content_type}\r\n\r\n").encode())
    body.extend(data)
    body.extend(b"\r\n--" + boundary.encode() + b"--\r\n")
    return bytes(body), "multipart/form-data; boundary=" + boundary


def eleven_post(url, api_key, body, content_type, timeout=60):
    req = Request(url, data=body, method="POST", headers={
        "xi-api-key": api_key,
        "Content-Type": content_type,
        "Accept": "application/json",
    })
    try:
        with urlopen(req, timeout=timeout) as response:
            return response.status, response.read()
    except Exception as exc:
        if hasattr(exc, "read"):
            raw = exc.read()
            raise RuntimeError(f"ElevenLabs request failed: {getattr(exc, 'code', '?')} {raw.decode('utf-8', 'replace')}")
        raise RuntimeError(str(exc))


def wav_bytes(pcm, sample_rate=SAMPLE_RATE):
    import io
    out = io.BytesIO()
    with wave.open(out, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return out.getvalue()


def normalize_target_wav():
    # Verify the repository target is a real PCM WAV without using any audio package.
    if not TARGET_WAV.exists():
        raise FileNotFoundError(f"Target WAV not found: {TARGET_WAV}")
    with wave.open(str(TARGET_WAV), "rb") as wf:
        if wf.getcomptype() != "NONE" or wf.getsampwidth() != 2:
            raise ValueError("Target WAV must be uncompressed 16-bit PCM WAV")
        return wf.getnchannels(), wf.getframerate(), wf.getnframes()


def get_voice_id(api_key):
    config = load_config()
    configured = str(config.get("voice_id") or "").strip()
    if configured:
        return configured
    if VOICE_ID_FILE.exists():
        saved = VOICE_ID_FILE.read_text(encoding="utf-8").strip()
        if saved:
            return saved

    channels, rate, frames = normalize_target_wav()
    if channels < 1 or rate < 8000 or frames <= 0:
        raise ValueError("Target WAV is empty or has an unsupported format")

    # ElevenLabs Voice Changer uses a voice_id as its target. A WAV cannot be
    # used as the target directly, so this one-time step creates an IVC voice.
    # If the WAV came from an existing ElevenLabs PVC, enter that original
    # voice_id in the UI instead and this clone step is skipped.
    audio = TARGET_WAV.read_bytes()
    body, content_type = multipart(
        {"name": "VoiceChanger Ava WAV Target", "description": "Authorized target voice created from the repository WAV."},
        "files[]",
        TARGET_WAV.name,
        audio,
    )
    status_code, raw = eleven_post(ELEVEN_BASE + "/v1/voices/add", api_key, body, content_type, 90)
    if status_code < 200 or status_code >= 300:
        detail = raw.decode("utf-8", "replace")
        raise RuntimeError(f"ElevenLabs target WAV clone failed ({status_code}): {detail}")
    try:
        voice_id = json.loads(raw.decode("utf-8"))["voice_id"]
    except Exception:
        raise RuntimeError("ElevenLabs returned an unexpected clone response: " + raw.decode("utf-8", "replace"))
    VOICE_ID_FILE.write_text(voice_id, encoding="utf-8")
    config["voice_id"] = voice_id
    save_config(config)
    return voice_id


def wave_format(rate=SAMPLE_RATE):
    fmt = WAVEFORMATEX()
    fmt.wFormatTag = 1
    fmt.nChannels = 1
    fmt.nSamplesPerSec = rate
    fmt.wBitsPerSample = 16
    fmt.nBlockAlign = 2
    fmt.nAvgBytesPerSec = rate * 2
    fmt.cbSize = 0
    return fmt


def capture_loop():
    global capture_handle
    fmt = wave_format()
    handle = HWAVEIN()
    callback_type = ctypes.WINFUNCTYPE(None, HWAVEIN, wintypes.UINT, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t)

    buffers = []
    headers = []

    def callback(hwi, msg, instance, param1, param2):
        if msg == WIM_DATA:
            hdr = ctypes.cast(param1, ctypes.POINTER(WAVEHDR)).contents
            if hdr.dwBytesRecorded:
                raw = ctypes.string_at(hdr.lpData, hdr.dwBytesRecorded)
                try:
                    mic_queue.put_nowait(raw)
                except queue.Full:
                    try:
                        mic_queue.get_nowait()
                        mic_queue.put_nowait(raw)
                    except queue.Empty:
                        pass
            if running:
                winmm.waveInAddBuffer(hwi, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))

    callback_ref = callback_type(callback)
    result = winmm.waveInOpen(ctypes.byref(handle), WAVE_MAPPER, ctypes.byref(fmt), ctypes.cast(callback_ref, ctypes.c_void_p).value, 0, CALLBACK_FUNCTION)
    if result:
        raise RuntimeError(f"Windows microphone open failed: {result}")
    capture_handle = handle

    try:
        for _ in range(4):
            buf = ctypes.create_string_buffer(CHUNK_BYTES)
            hdr = WAVEHDR(ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)), CHUNK_BYTES, 0, 0, 0, 0, None, 0)
            buffers.append(buf)
            headers.append(hdr)
            winmm.waveInPrepareHeader(handle, ctypes.pointer(headers[-1]), ctypes.sizeof(WAVEHDR))
            winmm.waveInAddBuffer(handle, ctypes.pointer(headers[-1]), ctypes.sizeof(WAVEHDR))
        winmm.waveInStart(handle)
        while running:
            time.sleep(0.05)
    finally:
        winmm.waveInStop(handle)
        winmm.waveInReset(handle)
        for hdr in headers:
            winmm.waveInUnprepareHeader(handle, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))
        winmm.waveInClose(handle)
        capture_handle = None


def play_pcm(pcm, rate=48000):
    global play_handle
    fmt = wave_format(rate)
    handle = HWAVEOUT()
    result = winmm.waveOutOpen(ctypes.byref(handle), WAVE_MAPPER, ctypes.byref(fmt), 0, 0, 0)
    if result:
        raise RuntimeError(f"Windows output open failed: {result}")
    play_handle = handle
    try:
        buffer = ctypes.create_string_buffer(pcm)
        hdr = WAVEHDR(ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)), len(pcm), 0, 0, 0, 0, None, 0)
        winmm.waveOutPrepareHeader(handle, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))
        winmm.waveOutWrite(handle, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))
        while running and not (hdr.dwFlags & WHDR_DONE):
            time.sleep(0.01)
        winmm.waveOutUnprepareHeader(handle, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))
    finally:
        winmm.waveOutReset(handle)
        winmm.waveOutClose(handle)
        play_handle = None


def convert_worker(api_key, voice_id):
    global running
    while running:
        try:
            audio = mic_queue.get(timeout=0.5)
        except queue.Empty:
            continue
        if len(audio) < 3200:
            continue

        body, content_type = multipart(
            {
                "model_id": "eleven_multilingual_sts_v2",
                "file_format": "pcm_s16le_16",
                "remove_background_noise": "false",
            },
            "audio",
            "live.wav",
            audio,
            "application/octet-stream",
        )
        try:
            # PCM is requested for low latency. The response is raw 48 kHz PCM,
            # which can be sent straight to the Windows WaveOut API.
            req = Request(
                f"{ELEVEN_BASE}/v1/speech-to-speech/{voice_id}?output_format=pcm_48000",
                data=body,
                method="POST",
                headers={"xi-api-key": api_key, "Content-Type": content_type, "Accept": "application/octet-stream"},
            )
            with urlopen(req, timeout=45) as response:
                output = response.read()
            if running and output:
                set_status("LIVE — WAV/PCM → ElevenLabs → Windows audio")
                play_pcm(output, 48000)
        except Exception as exc:
            set_status("Conversion error", str(exc))
            time.sleep(0.5)


def start_engine(api_key):
    global running, worker_thread
    if running:
        return
    if not api_key:
        raise ValueError("Enter an ElevenLabs API key")
    voice_id = get_voice_id(api_key)
    running = True
    set_status("Starting Windows microphone…")
    threading.Thread(target=capture_loop, daemon=True).start()
    worker_thread = threading.Thread(target=convert_worker, args=(api_key, voice_id), daemon=True)
    worker_thread.start()


def stop_engine():
    global running
    running = False
    while True:
        try:
            mic_queue.get_nowait()
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
            self._json({"running": running, "status": status, "error": last_error, "voice_id": config.get("voice_id", ""), "target_wav": TARGET_WAV.name})
            return
        if path == "/devices":
            self._json([{"id": -1, "name": "Windows WaveOut default (use Windows Sound settings)", "hostapi": "winmm"}])
            return
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        try:
            if path == "/start":
                start_engine(str(payload.get("api_key", "")).strip())
                self._json({"ok": True})
                return
            if path == "/stop":
                stop_engine()
                self._json({"ok": True})
                return
            if path == "/config":
                config = load_config()
                if "voice_id" in payload:
                    config["voice_id"] = str(payload["voice_id"]).strip()
                    if config["voice_id"]:
                        VOICE_ID_FILE.write_text(config["voice_id"], encoding="utf-8")
                save_config(config)
                self._json({"ok": True})
                return
            if path == "/clone":
                api_key = str(payload.get("api_key", "")).strip()
                if not api_key:
                    raise ValueError("Enter an ElevenLabs API key first")
                self._json({"ok": True, "voice_id": get_voice_id(api_key)})
                return
            self._json({"error": "not found"}, 404)
        except Exception as exc:
            set_status("Error", str(exc))
            self._json({"ok": False, "error": str(exc)}, 500)

    def log_message(self, fmt, *args):
        return


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[VoiceChanger] Python standard-library engine listening on http://{HOST}:{PORT}", flush=True)
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
