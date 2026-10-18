from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

HOST = "127.0.0.1"
PORT = 8765
URL = f"http://{HOST}:{PORT}/"
HEALTH_URL = f"http://{HOST}:{PORT}/health"


def open_chrome(url: str) -> None:
    """Prefer Google Chrome when installed; otherwise use the default browser."""
    if sys.platform == "win32":
        candidates = [
            Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
        ]
        for candidate in candidates:
            if candidate.is_file():
                subprocess.Popen([str(candidate), url], close_fds=True)
                return
    try:
        if webbrowser.get("chrome").open(url):
            return
    except webbrowser.Error:
        pass
    webbrowser.open(url)


def wait_until_ready(timeout: float = 180.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=1.5) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False


def main() -> int:
    print("VoiceChanger desktop launcher")
    print(f"Local interface: {URL}")
    print("Starting voiceclonnx backend. First startup may take a while.")
    config = uvicorn.Config("backend.app:app", host=HOST, port=PORT, log_level="info")
    server = uvicorn.Server(config)
    server_thread = threading.Thread(target=server.run, name="voicechanger-backend", daemon=True)
    server_thread.start()

    try:
        if not wait_until_ready():
            print("The backend did not become ready. Check the errors above.")
            return 1
        print("Backend is ready. Opening Chrome...")
        open_chrome(URL)
        print("Keep this window open while using VoiceChanger. Press Ctrl+C to stop.")
        while server_thread.is_alive():
            server_thread.join(timeout=0.5)
    except KeyboardInterrupt:
        print("\nStopping VoiceChanger...")
        server.should_exit = True
        server_thread.join(timeout=10)
    finally:
        server.should_exit = True
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
