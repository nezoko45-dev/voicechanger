import base64, json, os, socket, subprocess, threading, time, urllib.request, tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(getattr(__import__('sys'), '_MEIPASS', Path(__file__).resolve().parent))
WEB = ROOT / 'web'
DEEPGRAM_KEY = ''

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): print('[VoiceChanger]', fmt % args)
    def sendx(self, code, body, typ='application/json'):
        if isinstance(body, str): body = body.encode()
        self.send_response(code); self.send_header('Content-Type', typ); self.send_header('Cache-Control','no-store'); self.send_header('Access-Control-Allow-Origin','*'); self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self): self.sendx(204, b'', 'text/plain')
    def do_GET(self):
        global DEEPGRAM_KEY
        path = self.path.split('?', 1)[0]
        if path == '/api/deepgram-token':
            if not DEEPGRAM_KEY: return self.sendx(400, json.dumps({'error':'Deepgram key not configured'}))
            req = urllib.request.Request('https://api.deepgram.com/v1/auth/grant', data=b'{"ttl_seconds":3600}', headers={'Authorization':'Token '+DEEPGRAM_KEY,'Content-Type':'application/json'}, method='POST')
            try:
                with urllib.request.urlopen(req, timeout=15) as r: token = json.loads(r.read())['access_token']
                return self.sendx(200, token, 'text/plain')
            except Exception as e: return self.sendx(502, json.dumps({'error':str(e)}))
        if path == '/': path = '/index.html'
        file = (WEB / path.lstrip('/')).resolve()
        if WEB.resolve() not in file.parents or not file.is_file(): return self.sendx(404, 'Not found', 'text/plain')
        types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css'}
        self.sendx(200, file.read_bytes(), types.get(file.suffix, 'application/octet-stream'))
    def do_POST(self):
        global DEEPGRAM_KEY
        n = int(self.headers.get('Content-Length','0'))
        if n > 25*1024*1024: return self.sendx(413, '{"error":"Request too large"}')
        data = json.loads(self.rfile.read(n))
        if self.path == '/api/config':
            DEEPGRAM_KEY = str(data.get('deepgram_key','')).strip(); return self.sendx(200, '{"ok":true}')
        if self.path == '/api/tts':
            try:
                import soundfile as sf
                from tts_engine import clone_to_wav
                raw = base64.b64decode(str(data['ref_audio']))
                with tempfile.TemporaryDirectory() as d:
                    ref = Path(d) / 'reference.wav'; ref.write_bytes(raw)
                    wav, sr = clone_to_wav(str(data['text']), str(ref), str(data.get('ref_text','')))
                    out = Path(d) / 'output.wav'; sf.write(out, wav, sr, subtype='PCM_16'); encoded = base64.b64encode(out.read_bytes()).decode()
                return self.sendx(200, encoded, 'text/plain')
            except Exception as e: return self.sendx(500, json.dumps({'error':str(e)}))
        return self.sendx(404, 'Not found', 'text/plain')

def find_chrome():
    paths = [os.path.join(os.environ.get('PROGRAMFILES', r'C:\Program Files'), r'Google\Chrome\Application\chrome.exe'), os.path.join(os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)'), r'Google\Chrome\Application\chrome.exe'), os.path.join(os.environ.get('LOCALAPPDATA',''), r'Google\Chrome\Application\chrome.exe')]
    for path in paths:
        if os.path.isfile(path): return path
    return None

def main():
    probe = socket.socket(); probe.bind(('127.0.0.1',0)); port = probe.getsockname()[1]; probe.close()
    server = ThreadingHTTPServer(('127.0.0.1',port), Handler); threading.Thread(target=server.serve_forever,daemon=True).start(); url=f'http://127.0.0.1:{port}/'
    chrome=find_chrome()
    if chrome: subprocess.Popen([chrome,'--new-window',url])
    elif hasattr(os,'startfile'): os.startfile(url)
    print('VoiceChanger Browser:',url)
    while True: time.sleep(3600)

if __name__ == '__main__': main()
