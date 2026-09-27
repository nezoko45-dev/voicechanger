import os,sys,time,subprocess,threading,webbrowser
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path

ROOT=Path(__file__).resolve().parent
UI_PORT=8765
BACKEND_PORT=8766
backend=None
lock=threading.Lock()

REPEAT_PROMPT=(
"REPEAT-ONLY MODE. When the user speaks, repeat exactly the words you heard. "
"Do not answer the user. Do not greet them. Do not ask questions. "
"Do not add, remove, explain, summarize, or paraphrase. "
"Your response must contain only the user's spoken words, reproduced as faithfully as possible."
)

class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path in ("/","/index.html","/app.js"):
   name="index.html" if self.path in ("/","/index.html") else "app.js"
   data=(ROOT/name).read_bytes()
   ct="text/html; charset=utf-8" if name.endswith(".html") else "application/javascript"
   self.send_response(200);self.send_header("Content-Type",ct);self.send_header("Content-Length",str(len(data)));self.end_headers();self.wfile.write(data);return
  if self.path=="/api/status":
   ok=backend is not None and backend.poll() is None
   self.send_response(200);self.send_header("Content-Type","application/json");self.end_headers()
   self.wfile.write(('{"backend":'+str(ok).lower()+'}').encode());return
  self.send_response(404);self.end_headers()
 def log_message(self,*a): pass

def start_backend():
 global backend
 cmd=[
   "uvx","--from","speech-to-speech[kokoro]","speech-to-speech","serve",
   "--host","127.0.0.1","--port",str(BACKEND_PORT),
   "--stt","parakeet-tdt",
   "--llm_backend","transformers",
   "--model_name","Qwen/Qwen3-0.6B",
   "--llm_device","cuda" if os.system("nvidia-smi >nul 2>&1")==0 else "cpu",
   "--llm_torch_dtype","float16" if os.system("nvidia-smi >nul 2>&1")==0 else "float32",
   "--llm_gen_max_new_tokens","128",
   "--llm_gen_temperature","0.1",
   "--llm_gen_do_sample","false",
   "--init_chat_prompt",REPEAT_PROMPT,
   "--tts","kokoro",
   "--kokoro_voice","af_heart",
   "--enable_live_transcription"
 ]
 print("Starting local Hugging Face speech-to-speech backend...")
 backend=subprocess.Popen(cmd,cwd=ROOT)
 print("Backend PID:",backend.pid)

def main():
 threading.Thread(target=start_backend,daemon=True).start()
 time.sleep(1)
 srv=ThreadingHTTPServer(("127.0.0.1",UI_PORT),Handler)
 print(f"VoiceChanger UI: http://127.0.0.1:{UI_PORT}")
 try:webbrowser.open(f"http://127.0.0.1:{UI_PORT}")
 except Exception:pass
 try:srv.serve_forever()
 finally:
  if backend and backend.poll() is None:
   backend.terminate()

if __name__=="__main__":main()