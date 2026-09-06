import os
import base64
import json
from http.server import BaseHTTPRequestHandler, HTTPServer


DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "").strip()
FISH_API_KEY = os.environ.get("FISH_API_KEY", "").strip()
FISH_REFERENCE_ID = os.environ.get("FISH_REFERENCE_ID", "").strip()
FISH_MODEL = os.environ.get("FISH_MODEL", "s2.1-pro-free").strip()
DEEPGRAM_MODEL = os.environ.get("DEEPGRAM_MODEL", "nova-3").strip()


PAGE = r'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VoiceChanger</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:radial-gradient(circle at top,#25143c,#09070d 55%);color:#fff;display:grid;place-items:center;padding:24px}.card{width:min(760px,100%);background:rgba(18,15,25,.92);border:1px solid #3b3048;border-radius:24px;padding:30px;box-shadow:0 20px 70px #0008}.logo{font-size:34px;font-weight:800}.sub{color:#aaa;margin:6px 0 26px}.row{display:flex;gap:12px;flex-wrap:wrap}button{border:0;border-radius:14px;padding:14px 20px;font-size:16px;font-weight:700;cursor:pointer;background:#7c3aed;color:#fff}button.secondary{background:#292330}button:disabled{opacity:.45;cursor:not-allowed}.status{margin-top:18px;padding:12px 14px;border-radius:12px;background:#15121b;color:#bdb5c8}.panel{margin-top:18px;padding:16px;border:1px solid #302837;border-radius:16px;background:#100d15}.label{font-size:12px;color:#8f8799;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}.text{min-height:30px;font-size:18px}.meter{height:8px;background:#28232e;border-radius:99px;overflow:hidden;margin-top:14px}.bar{height:100%;width:0;background:#a855f7;transition:width .08s}.hint{color:#888;font-size:13px;margin-top:18px;line-height:1.5}audio{width:100%;margin-top:12px}
</style>
</head>
<body>
<main class="card">
<div class="logo">🎙️ VoiceChanger</div>
<div class="sub">🎤 Microphone → Deepgram → Fish Audio → 🔊 Voice</div>
<div class="row">
<button id="start">🎤 Start recording</button>
<button id="stop" class="secondary" disabled>⏹ Stop & convert</button>
</div>
<div class="meter"><div id="bar" class="bar"></div></div>
<div id="status" class="status">Ready.</div>
<div class="panel"><div class="label">Transcript</div><div id="transcript" class="text">—</div></div>
<div class="panel"><div class="label">Converted voice</div><audio id="audio" controls autoplay></audio></div>
<div class="hint">Your browser records one speech turn, sends the audio to Deepgram for transcription, then sends the resulting text to Fish Audio for speech synthesis. API keys remain on the server.</div>
</main>
<script>
let recorder=null,chunks=[];
const start=document.getElementById('start'),stop=document.getElementById('stop'),status=document.getElementById('status'),transcript=document.getElementById('transcript'),audio=document.getElementById('audio'),bar=document.getElementById('bar');
start.onclick=async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});chunks=[];recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());await convert(new Blob(chunks,{type:recorder.mimeType||'audio/webm'}))};recorder.start();start.disabled=true;stop.disabled=false;status.textContent='🎤 Listening...';bar.style.width='100%'}catch(e){status.textContent='Microphone error: '+e.message}};
stop.onclick=()=>{if(recorder&&recorder.state!=='inactive'){recorder.stop();stop.disabled=true;start.disabled=false;status.textContent='⏳ Converting...';bar.style.width='55%'}};
async function convert(blob){try{const fd=new FormData();fd.append('audio',blob,'speech.webm');const r=await fetch('/convert',{method:'POST',body:fd});const data=await r.json();if(!r.ok)throw new Error(data.error||'Conversion failed');transcript.textContent=data.transcript||'—';if(data.audio){audio.src='data:audio/mpeg;base64,'+data.audio;await audio.play().catch(()=>{});}status.textContent='✅ Converted successfully';bar.style.width='100%'}catch(e){status.textContent='❌ '+e.message;bar.style.width='0%'}}
</script>
</body>
</html>'''


def run_command(command, args):
    import subprocess
    result = subprocess.run([command, *args], capture_output=True, text=True, timeout=90)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"{command} failed")
    return result.stdout


def post_multipart(body, content_type):
    import re
    match = re.search(r'boundary=([^;]+)', content_type)
    if not match:
        raise ValueError("Missing multipart boundary")
    boundary = match.group(1).encode()
    marker = b'--' + boundary
    parts = body.split(marker)
    for part in parts:
        if b'filename=' not in part:
            continue
        head, data = part.split(b'\r\n\r\n', 1)
        return data.rsplit(b'\r\n', 1)[0]
    raise ValueError("Audio upload not found")


def deepgram(audio_bytes, content_type):
    import urllib.request
    req = urllib.request.Request(
        'https://api.deepgram.com/v1/listen?model=' + urllib.parse.quote(DEEPGRAM_MODEL) + '&smart_format=true&punctuate=true',
        data=audio_bytes,
        headers={'Authorization':'Token '+DEEPGRAM_API_KEY,'Content-Type':content_type},
        method='POST')
    with urllib.request.urlopen(req, timeout=60) as response:
        payload=json.loads(response.read())
    return payload.get('results',{}).get('channels',[{}])[0].get('alternatives',[{}])[0].get('transcript','').strip()


def fish(text):
    import urllib.request
    body={'text':text,'format':'mp3','model':FISH_MODEL}
    if FISH_REFERENCE_ID:
        body['reference_id']=FISH_REFERENCE_ID
    data=json.dumps(body).encode()
    req=urllib.request.Request('https://api.fish.audio/v1/tts',data=data,headers={'Authorization':'Bearer '+FISH_API_KEY,'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(req,timeout=90) as response:
        return response.read()


class Handler(BaseHTTPRequestHandler):
    def send_json(self, code, obj):
        data=json.dumps(obj).encode()
        self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

    def do_GET(self):
        if self.path in ('/','/index.html'):
            data=PAGE.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
        self.send_error(404)

    def do_POST(self):
        if self.path!='/convert': self.send_error(404);return
        try:
            if not DEEPGRAM_API_KEY or not FISH_API_KEY:
                raise RuntimeError('Set DEEPGRAM_API_KEY and FISH_API_KEY in your deployment environment.')
            length=int(self.headers.get('Content-Length','0'))
            if length<=0 or length>25*1024*1024: raise ValueError('Invalid audio upload size')
            raw=self.rfile.read(length)
            audio=post_multipart(raw,self.headers.get('Content-Type',''))
            transcript=deepgram(audio,'audio/webm')
            if not transcript: self.send_json(200,{'transcript':'','audio':''});return
            output=fish(transcript)
            self.send_json(200,{'transcript':transcript,'audio':base64.b64encode(output).decode()})
        except Exception as e:
            self.send_json(500,{'error':str(e)})

    def log_message(self, format, *args):
        pass


if __name__=='__main__':
    port=int(os.environ.get('PORT','7860'))
    print('VoiceChanger page running on port',port)
    HTTPServer(('0.0.0.0',port),Handler).serve_forever()
