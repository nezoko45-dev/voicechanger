import ctypes
import ctypes.wintypes as wintypes
import io
import json
import math
import queue
import struct
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

# WAV-only Windows voice effect engine.
# Standard library only: no pip packages, no cloud voice IDs, no API calls.
# The bundled WAV is used as the target voice profile. This is local DSP,
# not neural speaker cloning: it estimates the target pitch and loudness and
# applies a pitch/time-preserving grain transform to live microphone WAV chunks.

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
TARGET_WAV = REPO_ROOT / "ElevenLabs_2026-08-16T20_54_01_Ava – Natural AI Voice_pvc_sp100_s50_sb75_se36_b_e2.wav"
CONFIG_FILE = ROOT / "config.json"
HOST = "127.0.0.1"
PORT = 17856
SAMPLE_RATE = 16000
CHUNK_MS = 900
CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_MS // 1000
CHUNK_BYTES = CHUNK_SAMPLES * 2

winmm = ctypes.WinDLL("winmm.dll")

class WAVEFORMATEX(ctypes.Structure):
    _fields_ = [("wFormatTag", wintypes.WORD), ("nChannels", wintypes.WORD), ("nSamplesPerSec", wintypes.DWORD), ("nAvgBytesPerSec", wintypes.DWORD), ("nBlockAlign", wintypes.WORD), ("wBitsPerSample", wintypes.WORD), ("cbSize", wintypes.WORD)]

class WAVEHDR(ctypes.Structure):
    _fields_ = [("lpData", ctypes.POINTER(ctypes.c_char)), ("dwBufferLength", wintypes.DWORD), ("dwBytesRecorded", wintypes.DWORD), ("dwUser", ctypes.c_size_t), ("dwFlags", wintypes.DWORD), ("dwLoops", wintypes.DWORD), ("lpNext", ctypes.c_void_p), ("reserved", ctypes.c_size_t)]

HWAVEIN = wintypes.HANDLE
HWAVEOUT = wintypes.HANDLE
WAVE_MAPPER = 0xFFFFFFFF
CALLBACK_FUNCTION = 0x00030000
WIM_DATA = 0x3C0
WHDR_DONE = 0x00000001

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

mic_queue = queue.Queue(maxsize=6)
running = False
status = "Stopped"
last_error = ""
target_pitch = 170.0
target_rms = 0.18


def load_config():
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"target_wav": TARGET_WAV.name, "pitch_strength": 0.82, "output_gain": 1.0}


def save_config(config):
    CONFIG_FILE.write_text(json.dumps(config, indent=2), encoding="utf-8")


def set_status(value, error=""):
    global status, last_error
    status = value
    last_error = error
    print("[VoiceChanger] " + value + (": " + error if error else ""), flush=True)


def read_wav_pcm(path, max_seconds=60):
    with wave.open(str(path), "rb") as wf:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2 or wf.getcomptype() != "NONE":
            raise RuntimeError("Target WAV must be mono 16-bit PCM")
        rate = wf.getframerate()
        frames = min(wf.getnframes(), int(rate * max_seconds))
        data = wf.readframes(frames)
    if rate != SAMPLE_RATE:
        data = resample_pcm(data, rate, SAMPLE_RATE)
    return data


def samples_from_pcm(pcm):
    count = len(pcm) // 2
    return list(struct.unpack("<%dh" % count, pcm)) if count else []


def pcm_from_samples(samples):
    clipped = [max(-32768, min(32767, int(x))) for x in samples]
    return struct.pack("<%dh" % len(clipped), *clipped) if clipped else b""


def resample_pcm(pcm, source_rate, target_rate):
    if source_rate == target_rate:
        return pcm
    src = samples_from_pcm(pcm)
    if not src:
        return b""
    out_len = max(1, int(len(src) * target_rate / source_rate))
    out = []
    scale = source_rate / target_rate
    for i in range(out_len):
        pos = i * scale
        a = min(int(pos), len(src) - 1)
        b = min(a + 1, len(src) - 1)
        frac = pos - a
        out.append(src[a] * (1.0 - frac) + src[b] * frac)
    return pcm_from_samples(out)


def rms(samples):
    if not samples:
        return 0.0
    return math.sqrt(sum(float(x) * float(x) for x in samples) / len(samples)) / 32768.0


def estimate_pitch(samples, rate):
    if len(samples) < rate // 10:
        return 0.0
    # Zero-crossing estimate, restricted to the human voice range.
    crossings = 0
    previous = samples[0]
    for value in samples[1:]:
        if (previous < 0 <= value) or (previous >= 0 > value):
            crossings += 1
        previous = value
    hz = crossings * rate / (2.0 * len(samples))
    if 70.0 <= hz <= 320.0:
        return hz
    return 0.0


def load_target_profile():
    global target_pitch, target_rms
    if not TARGET_WAV.exists():
        raise FileNotFoundError("Target WAV is missing: " + str(TARGET_WAV))
    pcm = read_wav_pcm(TARGET_WAV)
    samples = samples_from_pcm(pcm)
    if not samples:
        raise RuntimeError("Target WAV contains no audio")
    pitch = estimate_pitch(samples, SAMPLE_RATE)
    target_pitch = pitch if pitch else 170.0
    target_rms = max(0.08, min(0.35, rms(samples)))
    set_status("Target WAV profile loaded")


def pitch_shift_chunk(pcm):
    samples = samples_from_pcm(pcm)
    if len(samples) < 400:
        return pcm
    source_pitch = estimate_pitch(samples, SAMPLE_RATE)
    if source_pitch <= 0:
        source_pitch = target_pitch
    ratio = target_pitch / source_pitch
    # Keep the effect useful but avoid extreme artifacts.
    ratio = max(0.72, min(1.45, ratio))
    strength = float(load_config().get("pitch_strength", 0.82))
    effective = 1.0 + (ratio - 1.0) * max(0.0, min(1.0, strength))

    # Grain-based resampling: changes pitch while restoring the original
    # chunk length, so speech timing remains approximately unchanged.
    grain = max(240, SAMPLE_RATE // 25)
    hop = grain // 2
    output = [0.0] * len(samples)
    weights = [0.0] * len(samples)
    position = 0
    while position < len(samples):
        end = min(len(samples), position + grain)
        source = samples[position:end]
        if len(source) < 32:
            break
        desired = max(16, int(len(source) / effective))
        shifted = samples_from_pcm(resample_pcm(pcm_from_samples(source), SAMPLE_RATE, max(1, int(SAMPLE_RATE * effective))))
        if len(shifted) < 2:
            shifted = source
        for j in range(len(source)):
            src_pos = j * (len(shifted) - 1) / max(1, len(source) - 1)
            a = min(int(src_pos), len(shifted) - 1)
            b = min(a + 1, len(shifted) - 1)
            frac = src_pos - a
            value = shifted[a] * (1.0 - frac) + shifted[b] * frac
            phase = (j / max(1, len(source) - 1))
            envelope = 0.5 - 0.5 * math.cos(2.0 * math.pi * phase)
            idx = position + j
            output[idx] += value * envelope
            weights[idx] += envelope
        position += hop
    result = [output[i] / weights[i] if weights[i] > 0.0001 else samples[i] for i in range(len(samples))]

    source_level = rms(samples)
    if source_level > 0.001:
        gain = min(2.0, max(0.5, target_rms / source_level))
        gain = 0.55 + gain * 0.45
        result = [x * gain for x in result]
    return pcm_from_samples(result)


def wave_format(rate):
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
    global running
    fmt = wave_format(SAMPLE_RATE)
    handle = HWAVEIN()
    callback_type = ctypes.WINFUNCTYPE(None, HWAVEIN, wintypes.UINT, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t)
    buffers, headers = [], []

    def callback(hwi, msg, instance, param1, param2):
        if msg != WIM_DATA:
            return
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
        raise RuntimeError("Windows microphone open failed: %s" % result)
    try:
        for _ in range(4):
            buf = ctypes.create_string_buffer(CHUNK_BYTES)
            hdr = WAVEHDR(ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)), CHUNK_BYTES, 0, 0, 0, 0, None, 0)
            buffers.append(buf)
            headers.append(hdr)
            result = winmm.waveInPrepareHeader(handle, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))
            if result:
                raise RuntimeError("Windows microphone prepare failed: %s" % result)
            result = winmm.waveInAddBuffer(handle, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))
            if result:
                raise RuntimeError("Windows microphone buffer failed: %s" % result)
        result = winmm.waveInStart(handle)
        if result:
            raise RuntimeError("Windows microphone start failed: %s" % result)
        while running:
            time.sleep(0.05)
    finally:
        try:
            winmm.waveInStop(handle)
            winmm.waveInReset(handle)
            for hdr in headers:
                winmm.waveInUnprepareHeader(handle, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))
            winmm.waveInClose(handle)
        except Exception:
            pass


def play_pcm(pcm):
    fmt = wave_format(SAMPLE_RATE)
    handle = HWAVEOUT()
    result = winmm.waveOutOpen(ctypes.byref(handle), WAVE_MAPPER, ctypes.byref(fmt), 0, 0, 0)
    if result:
        raise RuntimeError("Windows output open failed: %s" % result)
    try:
        buffer = ctypes.create_string_buffer(pcm)
        hdr = WAVEHDR(ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)), len(pcm), 0, 0, 0, 0, None, 0)
        result = winmm.waveOutPrepareHeader(handle, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))
        if result:
            raise RuntimeError("Windows output prepare failed: %s" % result)
        result = winmm.waveOutWrite(handle, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))
        if result:
            raise RuntimeError("Windows output write failed: %s" % result)
        while running and not (hdr.dwFlags & WHDR_DONE):
            time.sleep(0.01)
        winmm.waveOutUnprepareHeader(handle, ctypes.pointer(hdr), ctypes.sizeof(WAVEHDR))
    finally:
        winmm.waveOutReset(handle)
        winmm.waveOutClose(handle)


def convert_worker():
    global running
    while running:
        try:
            pcm = mic_queue.get(timeout=0.5)
        except queue.Empty:
            continue
        if len(pcm) < 3200:
            continue
        try:
            output = pitch_shift_chunk(pcm)
            if running and output:
                set_status("LIVE — WAV → local target profile → WAV")
                play_pcm(output)
        except Exception as exc:
            set_status("Conversion error", str(exc))
            time.sleep(0.25)


def start_engine():
    global running
    if running:
        return
    load_target_profile()
    load_config()
    running = True
    set_status("Starting Windows microphone…")
    threading.Thread(target=capture_loop, daemon=True).start()
    threading.Thread(target=convert_worker, daemon=True).start()


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
            self._json({"running": running, "status": status, "error": last_error, "target_wav": TARGET_WAV.name, "target_pitch": round(target_pitch, 1)})
            return
        if path == "/devices":
            self._json([{"id": -1, "name": "Windows WaveOut default", "hostapi": "winmm"}])
            return
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            payload = {}
        try:
            if path == "/start":
                start_engine()
                self._json({"ok": True})
                return
            if path == "/stop":
                stop_engine()
                self._json({"ok": True})
                return
            if path == "/config":
                config = load_config()
                if "pitch_strength" in payload:
                    config["pitch_strength"] = max(0.0, min(1.0, float(payload["pitch_strength"])))
                if "output_gain" in payload:
                    config["output_gain"] = max(0.2, min(2.0, float(payload["output_gain"])))
                save_config(config)
                self._json({"ok": True})
                return
            self._json({"error": "not found"}, 404)
        except Exception as exc:
            set_status("Error", str(exc))
            self._json({"ok": False, "error": str(exc)}, 500)

    def log_message(self, fmt, *args):
        return


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("[VoiceChanger] WAV-only local engine listening on http://%s:%d" % (HOST, PORT), flush=True)
    print("[VoiceChanger] Target WAV: %s" % TARGET_WAV, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_engine()
        server.server_close()


if __name__ == "__main__":
    main()
