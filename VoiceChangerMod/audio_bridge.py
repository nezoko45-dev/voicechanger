import json
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import sounddevice as sd
import websocket

HOST = "127.0.0.1"
PORT = 17846
SAMPLE_RATE = 48000
BLOCK = 3840

state = {"running": False, "api_key": "", "input_device": None, "output_device": None, "voice": "aura-2-thalia-en", "transcript": "", "error": ""}
lock = threading.RLock()
audio_queue = queue.Queue(maxsize=32)
stop_event = threading.Event()
input_stream = output_stream = stt_ws = tts_ws = None


def devices():
    return [{"index": i, "name": d["name"], "inputs": d["max_input_channels"], "outputs": d["max_output_channels"]} for i, d in enumerate(sd.query_devices())]


def device_index(value, want_input):
    if value is None:
        return None
    try:
        return int(value)
    except Exception:
        needle = str(value).lower()
        for i, d in enumerate(sd.query_devices()):
            channels = d["max_input_channels"] if want_input else d["max_output_channels"]
            if channels and needle in d["name"].lower():
                return i
    return None


def downsample_48_to_16(raw):
    if len(raw) < 6:
        return b""
    out = bytearray((len(raw) // 6) * 2)
    src = memoryview(raw)
    pos = 0
    for i in range(0, len(raw) - 5, 6):
        out[pos:pos + 2] = src[i:i + 2]
        pos += 2
    return bytes(out)


def input_callback(indata, frames, time_info, status):
    if stop_event.is_set():
        return
    try:
        audio_queue.put_nowait(bytes(indata))
    except queue.Full:
        try:
            audio_queue.get_nowait()
            audio_queue.put_nowait(bytes(indata))
        except queue.Empty:
            pass


def stt_sender(ws):
    while not stop_event.is_set():
        try:
            raw = audio_queue.get(timeout=0.2)
        except queue.Empty:
            continue
        try:
            ws.send(downsample_48_to_16(raw), opcode=websocket.ABNF.OPCODE_BINARY)
        except Exception as exc:
            with lock: state["error"] = "STT send: " + str(exc)
            break


def tts_receiver(ws, stream):
    while not stop_event.is_set():
        try: msg = ws.recv()
        except Exception as exc:
            if not stop_event.is_set():
                with lock: state["error"] = "TTS receive: " + str(exc)
            break
        if msg is None: break
        if isinstance(msg, bytes):
            try: stream.write(msg)
            except Exception: break


def stt_receiver(ws):
    while not stop_event.is_set():
        try: msg = ws.recv()
        except Exception as exc:
            if not stop_event.is_set():
                with lock: state["error"] = "STT receive: " + str(exc)
            break
        if not msg or not isinstance(msg, str): continue
        try: data = json.loads(msg)
        except Exception: continue
        text = str(data.get("transcript", "")).strip()
        if text:
            with lock: state["transcript"] = text
        if data.get("event") == "EndOfTurn" and text and tts_ws:
            try:
                tts_ws.send(json.dumps({"type":"Speak", "text":text[:2000]}))
                tts_ws.send(json.dumps({"type":"Flush"}))
            except Exception as exc:
                with lock: state["error"] = "TTS send: " + str(exc)


def stop_audio():
    global input_stream, output_stream, stt_ws, tts_ws
    stop_event.set()
    for ws in (stt_ws, tts_ws):
        try:
            if ws: ws.close()
        except Exception: pass
    stt_ws = tts_ws = None
    for stream in (input_stream, output_stream):
        try:
            if stream:
                stream.stop(); stream.close()
        except Exception: pass
    input_stream = output_stream = None
    while True:
        try: audio_queue.get_nowait()
        except queue.Empty: break
    with lock: state["running"] = False


def start_audio():
    global input_stream, output_stream, stt_ws, tts_ws
    stop_audio(); stop_event.clear()
    with lock:
        key = state["api_key"].strip(); inp = state["input_device"]; out = state["output_device"]; voice = state["voice"]; state["error"] = ""
    if not key: raise RuntimeError("Deepgram API key is required")
    in_idx = device_index(inp, True); out_idx = device_index(out, False)
    if in_idx is None: raise RuntimeError("Audio Repeater output/input device was not found")
    if out_idx is None: raise RuntimeError("VAC/output device was not found")

    output_stream = sd.RawOutputStream(device=out_idx, samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=1920)
    output_stream.start()
    input_stream = sd.RawInputStream(device=in_idx, samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=BLOCK, callback=input_callback)
    input_stream.start()

    stt_url = "wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.70&eager_eot_threshold=0.50&eot_timeout_ms=7000"
    stt_ws = websocket.create_connection(stt_url, header=["Authorization: Token " + key], timeout=2)
    tts_url = "wss://api.deepgram.com/v1/speak?model=" + voice + "&encoding=linear16&sample_rate=48000"
    tts_ws = websocket.create_connection(tts_url, header=["Authorization: Token " + key], timeout=2)
    threading.Thread(target=stt_sender, args=(stt_ws,), daemon=True).start()
    threading.Thread(target=stt_receiver, args=(stt_ws,), daemon=True).start()
    threading.Thread(target=tts_receiver, args=(tts_ws, output_stream), daemon=True).start()
    with lock: state["running"] = True


class Handler(BaseHTTPRequestHandler):
    def _send(self, obj, code=200):
        raw = json.dumps(obj).encode("utf-8")
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS"); self.send_header("Access-Control-Allow-Headers", "Content-Type"); self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/devices":
            try: self._send({"devices":devices()})
            except Exception as exc: self._send({"error":str(exc)},500)
        elif path == "/status":
            with lock: self._send(dict(state))
        else: self._send({"error":"not found"},404)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length","0")); body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._send({"error":"invalid JSON"},400); return
        try:
            if path == "/config":
                with lock:
                    state["api_key"] = body.get("api_key",""); state["input_device"] = body.get("input_device")
                    state["output_device"] = body.get("output_device"); state["voice"] = body.get("voice","aura-2-thalia-en")
                self._send({"ok":True})
            elif path == "/start": start_audio(); self._send({"ok":True})
            elif path == "/stop": stop_audio(); self._send({"ok":True})
            else: self._send({"error":"not found"},404)
        except Exception as exc:
            stop_audio()
            with lock: state["error"] = str(exc)
            self._send({"error":str(exc)},500)

    def log_message(self, fmt, *args): pass


def main():
    server = ThreadingHTTPServer((HOST,PORT),Handler)
    print(f"VoiceChanger native audio bridge listening on http://{HOST}:{PORT}",flush=True)
    try: server.serve_forever()
    finally: stop_audio(); server.server_close()

if __name__ == "__main__": main()
