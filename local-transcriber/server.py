#!/usr/bin/env python3
"""Local-only Faster-Whisper transcription and comparison for Fish Audio Repeater Clicker."""
import base64,io,json,os,re,threading,time,wave
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import numpy as np
from faster_whisper import WhisperModel
HOST,PORT="127.0.0.1",8765
MODEL_NAME=os.environ.get("FISH_AUDIO_MODEL","base.en")
print(f"Loading local Whisper model {MODEL_NAME!r}; first run downloads it once.",flush=True)
model=WhisperModel(MODEL_NAME,device="cpu",compute_type="int8")
lock=threading.Lock();last_user_text="";last_user_at=0.0
def normalize(s):
 s=str(s or "").lower().replace("’","").replace("'","")
 return " ".join(re.sub(r"[^\w\s]"," ",s).split())
def transcribe(raw):
 with wave.open(io.BytesIO(raw),"rb") as wav:
  if wav.getnchannels()!=1 or wav.getsampwidth()!=2 or wav.getframerate()!=16000:raise ValueError("expected mono 16-bit PCM WAV at 16 kHz")
  audio=np.frombuffer(wav.readframes(wav.getnframes()),dtype=np.int16).astype(np.float32)/32768.0
 if len(audio)<16000//3:raise ValueError("audio clip too short")
 segments,_=model.transcribe(audio,language="en",beam_size=1,vad_filter=False,condition_on_previous_text=False)
 return " ".join(seg.text.strip() for seg in segments).strip()
class Handler(BaseHTTPRequestHandler):
 def _headers(self,code=200):
  self.send_response(code);self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Cache-Control","no-store")
  origin=self.headers.get("Origin","")
  if origin.startswith("chrome-extension://"):
   self.send_header("Access-Control-Allow-Origin",origin);self.send_header("Vary","Origin");self.send_header("Access-Control-Allow-Methods","POST, OPTIONS");self.send_header("Access-Control-Allow-Headers","Content-Type")
  self.end_headers()
 def do_GET(self):
  if self.path in ("/","/health"):
   self._headers();self.wfile.write(json.dumps({"ok":True,"service":"Fish Audio local transcriber","model":MODEL_NAME}).encode());return
  self._headers(404);self.wfile.write(b'{"error":"not found"}')
 def do_OPTIONS(self):
  if not self.headers.get("Origin","").startswith("chrome-extension://"):self._headers(403);return
  self._headers(204)
 def do_POST(self):
  global last_user_text,last_user_at
  if not self.headers.get("Origin","").startswith("chrome-extension://"):self._headers(403);self.wfile.write(b'{"error":"extension origin required"}');return
  if self.path!="/transcribe":self._headers(404);self.wfile.write(b'{"error":"not found"}');return
  try:
   length=int(self.headers.get("Content-Length","0"))
   if length<=0 or length>30000000:raise ValueError("invalid request size")
   payload=json.loads(self.rfile.read(length));role=payload.get("role")
   if role not in ("user","assistant"):raise ValueError("role must be user or assistant")
   text=transcribe(base64.b64decode(payload["audio"],validate=True));normalized=normalize(text);result={"text":text,"role":role,"status":"waiting"}
   if normalized:
    with lock:
     now=time.monotonic()
     if role=="user":last_user_text,last_user_at=normalized,now;result.update(status="user-heard",user=text)
     else:
      result["assistant"]=text
      if not last_user_text or now-last_user_at>45:result["status"]="waiting"
      else:
       result.update(status="match" if normalized==last_user_text else "mismatch",user=last_user_text,assistant=text)
       last_user_text,last_user_at="",0.0
   self._headers();self.wfile.write(json.dumps(result).encode())
  except Exception as exc:
   print("Transcription error:",type(exc).__name__,str(exc),flush=True);self._headers(400);self.wfile.write(json.dumps({"error":str(exc)}).encode())
 def log_message(self,fmt,*args):print("%s - %s"%(self.address_string(),fmt%args),flush=True)
if __name__=="__main__":
 print(f"Fish Audio local transcription server on http://{HOST}:{PORT}",flush=True);ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
