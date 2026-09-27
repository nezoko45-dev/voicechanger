import os
import sys
import time
import shutil
import subprocess
import threading
import webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).resolve().parent
else:
    ROOT = Path(__file__).resolve().parent

UI_PORT = 8765
BACKEND_PORT = 8766
backend = None

REPEAT_PROMPT = (
    "REPEAT-ONLY MODE. When the user speaks, repeat exactly the words you heard. "
    "Do not answer the user. Do not greet them. Do not ask questions. "
    "Do not add, remove, explain, summarize, or paraphrase. "
    "Your response must contain only the user's spoken words, reproduced as faithfully as possible."
)

def find_uvx():
    found = shutil.which("uvx")
    if found:
        return found

    home = Path(os.environ.get("USERPROFILE", ""))
    candidates = [
        home / ".local" / "bin" / "uvx.exe",
        home / ".local" / "bin" / "uvx",
        Path(os.environ.get("LOCALAPPDATA", "")) / "uv" / "uvx.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path in ("/", "/index.html", "/app.js"):
            name = "index.html" if path in ("/", "/index.html") else "app.js"
            file = ROOT / name
            if not file.exists():
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f"Missing {name}".encode())
                return

            data = file.read_bytes()
            content_type = (
                "text/html; charset=utf-8"
                if name.endswith(".html")
                else "application/javascript; charset=utf-8"
            )
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        if path == "/api/status":
            running = backend is not None and backend.poll() is None
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(
                ('{"backend":' + str(running).lower() + '}').encode()
            )
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, *args):
        pass

def start_backend():
    global backend

    uvx = find_uvx()
    if not uvx:
        print("ERROR: uvx was not found.")
        print("Run install.bat once, then start server.exe again.")
        return

    gpu = os.system("nvidia-smi >nul 2>&1") == 0

    cmd = [
        uvx,
        "--from",
        "speech-to-speech[kokoro]",
        "speech-to-speech",
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        str(BACKEND_PORT),
        "--stt",
        "parakeet-tdt",
        "--llm_backend",
        "transformers",
        "--model_name",
        "Qwen/Qwen3-0.6B",
        "--llm_device",
        "cuda" if gpu else "cpu",
        "--llm_torch_dtype",
        "float16" if gpu else "float32",
        "--llm_gen_max_new_tokens",
        "128",
        "--llm_gen_temperature",
        "0.0",
        "--llm_gen_do_sample",
        "false",
        "--init_chat_prompt",
        REPEAT_PROMPT,
        "--tts",
        "kokoro",
        "--kokoro_voice",
        "af_heart",
        "--enable_live_transcription",
    ]

    print("Starting local Hugging Face speech-to-speech backend...")
    print("Backend:", " ".join(cmd))

    try:
        backend = subprocess.Popen(cmd, cwd=str(ROOT))
        print("Backend PID:", backend.pid)
    except Exception as exc:
        print("ERROR starting backend:", exc)

def main():
    threading.Thread(target=start_backend, daemon=True).start()

    server = ThreadingHTTPServer(("127.0.0.1", UI_PORT), Handler)

    url = f"http://127.0.0.1:{UI_PORT}/"
    print("")
    print("========================================")
    print(" Local Hugging Face Repeat Voice")
    print("========================================")
    print("UI:", url)
    print("Backend: ws://127.0.0.1:8766/v1/realtime")
    print("Close this window to stop the local server.")
    print("")

    try:
        webbrowser.open(url)
    except Exception:
        pass

    try:
        server.serve_forever()
    finally:
        if backend and backend.poll() is None:
            backend.terminate()
            try:
                backend.wait(timeout=5)
            except Exception:
                backend.kill()

if __name__ == "__main__":
    main()
