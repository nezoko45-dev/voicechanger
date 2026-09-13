import os
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
WEB = ROOT / 'web'

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print('[VoiceChanger]', fmt % args)
    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/': path = '/index.html'
        file = (WEB / path.lstrip('/')).resolve()
        if WEB.resolve() not in file.parents or not file.is_file():
            self.send_response(404); self.end_headers(); return
        types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css'}
        self.send_response(200); self.send_header('Content-Type', types.get(file.suffix, 'application/octet-stream')); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(file.read_bytes())

def find_chrome():
    paths = [
        os.path.join(os.environ.get('PROGRAMFILES', r'C:\Program Files'), r'Google\Chrome\Application\chrome.exe'),
        os.path.join(os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)'), r'Google\Chrome\Application\chrome.exe'),
        os.path.join(os.environ.get('LOCALAPPDATA',''), r'Google\Chrome\Application\chrome.exe')]
    for path in paths:
        if os.path.isfile(path): return path
    return None

def main():
    probe = socket.socket(); probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]; probe.close()
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{port}/'
    chrome = find_chrome()
    if chrome: subprocess.Popen([chrome, '--new-window', url])
    elif hasattr(os, 'startfile'): os.startfile(url)
    print('VoiceChanger Browser:', url)
    while True: time.sleep(3600)

if __name__ == '__main__': main()
