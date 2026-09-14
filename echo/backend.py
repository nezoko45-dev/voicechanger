import base64, json, os, shutil, subprocess, tempfile, threading, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENGINE = ROOT.parent / 'openvoice' / 'engine.py'
PORT = int(os.environ.get('VOICECHANGER_PORT', '8765'))
PYTHON = os.environ.get('PYTHON', 'python')

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): print('[EchoBackend]', fmt % args)
    def _send(self, code, payload, content_type='application/json'):
        data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(code); self.send_header('Content-Type', content_type); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Access-Control-Allow-Headers','content-type'); self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_OPTIONS(self): self._send(204,b'')
    def do_GET(self):
        if self.path == '/health': self._send(200, {'ok':True,'engine':'OpenVoice V2'})
        else: self._send(200, {'name':'VoiceChanger Echo Backend','ok':True,'engine':'OpenVoice V2'})
    def do_POST(self):
        if self.path != '/generate': self._send(404, {'error':'Not found'}); return
        try:
            n=int(self.headers.get('Content-Length','0'))
            if n>40_000_000: raise ValueError('Request is too large.')
            body=json.loads(self.rfile.read(n))
            text=str(body.get('text','')).strip(); ref=body.get('reference_base64','')
            if not text: raise ValueError('No text supplied.')
            if not ref: raise ValueError('No reference voice supplied.')
            raw=base64.b64decode(ref, validate=True)
            if len(raw)>25_000_000: raise ValueError('Voice sample is too large.')
            with tempfile.TemporaryDirectory(prefix='vc-echo-') as td:
                td=Path(td); name=Path(str(body.get('reference_name','voice.wav'))).name
                if not name.lower().endswith(('.wav','.mp3','.m4a','.flac')): name='voice.wav'
                refpath=td/name; out=td/'output.wav'; refpath.write_bytes(raw)
                if not ENGINE.exists(): raise RuntimeError(f'OpenVoice engine missing: {ENGINE}')
                cmd=[PYTHON,str(ENGINE),'--ref-audio',str(refpath),'--text',text,'--output',str(out),'--language','English']
                p=subprocess.run(cmd,capture_output=True,text=True,timeout=180,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                if p.returncode!=0: raise RuntimeError((p.stderr or p.stdout or f'OpenVoice exited {p.returncode}')[-8000:])
                if not out.exists(): raise RuntimeError('OpenVoice did not produce output.wav')
                audio=base64.b64encode(out.read_bytes()).decode()
            self._send(200, {'ok':True,'audio_base64':audio,'mime':'audio/wav'})
        except Exception as e:
            self._send(500, {'ok':False,'error':str(e)})

def main():
    print(f'VoiceChanger Echo Backend listening on http://127.0.0.1:{PORT}')
    print('OpenVoice V2 is launched locally for each completed STT phrase.')
    ThreadingHTTPServer(('127.0.0.1',PORT),Handler).serve_forever()

if __name__=='__main__': main()
