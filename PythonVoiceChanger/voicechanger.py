import base64
import ctypes
import ctypes.wintypes as wintypes
import io
import json
import os
import time
import urllib.error
import urllib.request
import wave
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
    }
    data = None
    if method.upper() != "GET":
        data = json.dumps(payload or {}).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Resemble HTTP {exc.code}: {detail[:1200]}")
    except urllib.error.URLError as exc:
        raise RuntimeError("Could not reach Resemble: " + str(exc.reason))


def multipart_body(fields, file_name, file_data, content_type):
    boundary = "----VoiceChangerBoundary" + str(int(time.time() * 1000))
    chunks = []
    for name, value in fields.items():
        chunks.append((f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").encode())
    chunks.append((f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {content_type}\r\n\r\n").encode())
    chunks.append(file_data)
    chunks.append(f"\r\n--{boundary}--\r\n".encode())
    return boundary, b"".join(chunks)


def resemble_stt(audio_data, mime="audio/webm"):
    config = load_config()
    key = api_key(config)
    if not key:
        raise RuntimeError("Missing Resemble API key.")
    boundary, body = multipart_body({}, "microphone.webm", audio_data, mime)
    req = urllib.request.Request(RESEMBLE_STT, data=body, method="POST", headers={
        "Authorization": "Bearer " + key,
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        "Accept": "application/json",
    })
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
        status_result = request_json(f"https://app.resemble.ai/api/v2/speech-to-text/{job_id}", key, method="GET")
        item = status_result.get("item") or {}
        state = str(item.get("status") or "").lower()
        if state in ("completed", "complete", "finished", "succeeded", "success"):
            text = str(item.get("text") or "").strip()
            if not text:
                raise RuntimeError("Resemble STT completed but returned no text")
            return text
        if state in ("failed", "error", "cancelled"):
            raise RuntimeError("Resemble STT job failed")
    raise RuntimeError("Resemble STT timed out")


def resemble_tts(text, config):
    key = api_key(config)
    voice_uuid = str(config.get("voice_uuid") or "").strip()
    if not voice_uuid:
        raise RuntimeError("Select a Resemble custom voice first.")
    payload = {
        "voice_uuid": voice_uuid,
        "data": text,
        "sample_rate": int(config.get("sample_rate", 48000)),
        "output_format": "wav",
        "precision": "PCM_16",
    }
    result = request_json(RESEMBLE_SYNTH, key, payload, method="POST")
    if not result.get("success"):
        raise RuntimeError(str(result.get("issues") or result.get("error") or "Resemble TTS failed"))
    audio = result.get("audio_content")
    if not audio:
        raise RuntimeError("Resemble TTS returned no audio")
    return base64.b64decode(audio), float(result.get("duration") or 0.0)


def list_voices():
    config = load_config()
    key = api_key(config)
    if not key:
        raise RuntimeError("Enter your Resemble API key first.")
    req = urllib.request.Request(RESEMBLE_VOICES + "?page=1&page_size=100", method="GET", headers={
        "Authorization": "Bearer " + key,
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Resemble voices HTTP {exc.code}: {detail[:1200]}")
    except urllib.error.URLError as exc:
        raise RuntimeError("Could not reach Resemble voices: " + str(exc.reason))
    return result.get("items") or []


def parse_wav(data):
    with wave.open(io.BytesIO(data), "rb") as wf:
        channels = wf.getnchannels()
        width = wf.getsampwidth()
        rate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())
    if channels != 1 or width != 2:
        raise RuntimeError("Resemble output must be mono 16-bit WAV.")
    return rate, frames


winmm = ctypes.WinDLL("winmm.dll")
class WAVEFORMATEX(ctypes.Structure):
    _fields_ = [("wFormatTag", wintypes.WORD),("nChannels", wintypes.WORD),("nSamplesPerSec", wintypes.DWORD),("nAvgBytesPerSec", wintypes.DWORD),("nBlockAlign", wintypes.WORD),("wBitsPerSample", wintypes.WORD),("cbSize", wintypes.WORD)]
class WAVEHDR(ctypes.Structure):
    _fields_ = [("lpData", ctypes.POINTER(ctypes.c_char)),("dwBufferLength", wintypes.DWORD),("dwBytesRecorded", wintypes.DWORD),("dwUser", ctypes.c_size_t),("dwFlags", wintypes.DWORD),("dwLoops", wintypes.DWORD),("lpNext", ctypes.c_void_p),("reserved", ctypes.c_size_t)]
HWAVEOUT = wintypes.HANDLE
WAVE_MAPPER = 0xFFFFFFFF
WHDR_DONE = 1
winmm.waveOutOpen.argtypes = [ctypes.POINTER(HWAVEOUT),wintypes.UINT,ctypes.POINTER(WAVEFORMATEX),ctypes.c_size_t,ctypes.c_size_t,wintypes.DWORD]
winmm.waveOutPrepareHeader.argtypes = [HWAVEOUT,ctypes.POINTER(WAVEHDR),wintypes.UINT]
winmm.waveOutWrite.argtypes = [HWAVEOUT,ctypes.POINTER(WAVEHDR),wintypes.UINT]
winmm.waveOutUnprepareHeader.argtypes = [HWAVEOUT,ctypes.POINTER(WAVEHDR),wintypes.UINT]
winmm.waveOutReset.argtypes = [HWAVEOUT]
winmm.waveOutClose.argtypes = [HWAVEOUT]


def play_wav(data):
    rate, pcm = parse_wav(data)
    fmt = WAVEFORMATEX(1,1,rate,rate*2,2,16,0)
    handle = HWAVEOUT()
    result = winmm.waveOutOpen(ctypes.byref(handle), WAVE_MAPPER, ctypes.byref(fmt), 0, 0, 0)
    if result: raise RuntimeError("Windows audio output open failed: %s" % result)
    try:
        buffer = ctypes.create_string_buffer(pcm)
        hdr = WAVEHDR(ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)),len(pcm),0,0,0,0,None,0)
        result = winmm.waveOutPrepareHeader(handle,ctypes.pointer(hdr),ctypes.sizeof(WAVEHDR))
        if result: raise RuntimeError("Windows audio prepare failed: %s" % result)
        result = winmm.waveOutWrite(handle,ctypes.pointer(hdr),ctypes.sizeof(WAVEHDR))
        if result: raise RuntimeError("Windows audio write failed: %s" % result)
        while running and not (hdr.dwFlags & WHDR_DONE): time.sleep(0.01)
        winmm.waveOutUnprepareHeader(handle,ctypes.pointer(hdr),ctypes.sizeof(WAVEHDR))
    finally:
        winmm.waveOutReset(handle); winmm.waveOutClose(handle)


def start_engine():
    global running
    config = load_config()
    if not api_key(config): raise RuntimeError("Enter your Resemble API key first.")
    if not str(config.get("voice_uuid") or "").strip(): raise RuntimeError("Select a Resemble custom voice first.")
    running = True
    set_status("Resemble STT/TTS ready")


def stop_engine():
    global running
    running = False
    set_status("Stopped")


class Handler(BaseHTTPRequestHandler):
    def _json(self, value, code=200):
        body=json.dumps(value).encode()
        self.send_response(code); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Cache-Control","no-store"); self.send_header("Access-Control-Allow-Origin",BROWSER_ORIGIN); self.send_header("Access-Control-Allow-Headers","Content-Type"); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self): self.send_response(204); self.send_header("Access-Control-Allow-Origin",BROWSER_ORIGIN); self.send_header("Access-Control-Allow-Headers","Content-Type"); self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS"); self.end_headers()
    def do_GET(self):
        path=urlparse(self.path).path
        if path=="/status":
            c=load_config(); self._json({"running":running,"status":status,"error":last_error,"voice_uuid_set":bool(str(c.get("voice_uuid") or "").strip()),"duration":last_duration}); return
        if path=="/config":
            c=load_config(); safe=dict(c); safe["api_key"]="configured" if api_key(c) else ""; self._json(safe); return
        if path=="/voices":
            try: self._json({"voices":list_voices()})
            except Exception as exc: self._json({"error":str(exc)},500)
            return
        self._json({"error":"Not found"},404)
    def do_POST(self):
        global last_duration
        path=urlparse(self.path).path
        if path=="/stt-tts":
            try:
                length=int(self.headers.get("Content-Length","0")); audio=self.rfile.read(length)
                if not audio: raise RuntimeError("No microphone audio received")
                config=load_config(); set_status("Resemble STT: transcribing microphone…")
                started=time.perf_counter(); text=resemble_stt(audio,self.headers.get("X-Audio-Type","audio/webm"))
                set_status("Resemble TTS: speaking with your custom voice…")
                output,duration=resemble_tts(text,config); last_duration=duration; play_wav(output)
                elapsed=time.perf_counter()-started; set_status("Ready — waiting for your next sentence")
                self._json({"ok":True,"text":text,"duration":duration,"elapsed":elapsed}); return
            except Exception as exc:
                set_status("Error",str(exc)); self._json({"error":str(exc)},500); return
        length=int(self.headers.get("Content-Length","0"))
        try: payload=json.loads(self.rfile.read(length).decode()) if length else {}
        except Exception: self._json({"error":"Invalid JSON"},400); return
        try:
            if path=="/config":
                c=load_config()
                for k in ("api_key","voice_uuid","source_url","pitch","prompt","sample_rate"):
                    if k in payload: c[k]=payload[k]
                save_config(c); self._json({"ok":True}); return
            if path=="/start": start_engine(); self._json({"ok":True,"status":status}); return
            if path=="/stop": stop_engine(); self._json({"ok":True}); return
            self._json({"error":"Not found"},404)
        except Exception as exc:
            set_status("Error",str(exc)); self._json({"error":str(exc)},500)
    def log_message(self,format,*args): return


def main():
    set_status("Resemble STT/TTS engine ready")
    server=ThreadingHTTPServer((HOST,PORT),Handler)
    print(f"[VoiceChanger] browser bridge listening on http://{HOST}:{PORT}",flush=True)
    server.serve_forever()

if __name__=="__main__": main()
