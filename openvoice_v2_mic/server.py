import asyncio, json, tempfile, uuid, os
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from voiceclonnx import VoiceCloner
ROOT=Path(__file__).resolve().parent
VOICE_DIR=ROOT/'voices'; VOICE_DIR.mkdir(parents=True,exist_ok=True)
app=FastAPI(); app.add_middleware(CORSMiddleware,allow_origins=['*'],allow_methods=['*'],allow_headers=['*'])
cloner=None; reference=None; lock=asyncio.Lock(); TARGET_SR=22050; MIN_WINDOW=.608
@app.get('/')
def index(): return FileResponse(ROOT/'index.html')
@app.get('/health')
def health(): return {'ok':True,'engine':'openvoice-v2','sample_rate':TARGET_SR,'min_window':MIN_WINDOW}
@app.post('/reference')
async def reference_upload(file:UploadFile=File(...)):
 global reference
 data=await file.read()
 if not data: raise ValueError('Reference audio upload was empty')
 p=VOICE_DIR/('reference_'+uuid.uuid4().hex+'.wav'); p.write_bytes(data)
 try:
  audio,sr=sf.read(p,dtype='float32',always_2d=False)
  if audio.ndim>1: audio=np.mean(audio,axis=1)
  if sr!=TARGET_SR: audio=resample_poly(audio,TARGET_SR,sr)
  sf.write(p,np.asarray(audio,dtype=np.float32),TARGET_SR,subtype='PCM_16')
  sf.read(p,dtype='float32')
 except Exception as e:
  try:p.unlink()
  except OSError:pass
  raise ValueError('Reference audio could not be normalized to PCM WAV: '+str(e))
 reference=p; return {'ok':True,'reference':p.name,'sample_rate':TARGET_SR}
def convert_chunk(pcm16,sample_rate):
 global cloner,reference
 if reference is None: raise RuntimeError('No reference WAV selected')
 audio=np.frombuffer(pcm16,dtype='<i2').astype(np.float32)/32768.0
 if audio.size<int(sample_rate*MIN_WINDOW): return None
 if sample_rate!=TARGET_SR: audio=resample_poly(audio,TARGET_SR,sample_rate)
 fd,name=tempfile.mkstemp(suffix='.wav',dir=VOICE_DIR); os.close(fd); src=Path(name)
 fd2,name2=tempfile.mkstemp(suffix='.wav',dir=VOICE_DIR); os.close(fd2); out=Path(name2)
 try:
  sf.write(src,audio,TARGET_SR,subtype='PCM_16')
  result=cloner.clone_voice(str(src),str(reference),str(out)); output_path=Path(result) if result else out
  if not output_path.exists(): raise RuntimeError('OpenVoice returned no output WAV')
  data=output_path.read_bytes()
  if not data: raise RuntimeError('OpenVoice returned empty audio')
  return data
 finally:
  for pth in (src,out):
   try:pth.unlink()
   except OSError:pass
async def ensure_engine():
 global cloner
 if cloner is None: cloner=await asyncio.to_thread(VoiceCloner,engine='openvoice',quantized=False)
@app.websocket('/ws')
async def ws(websocket:WebSocket):
 await websocket.accept()
 try:
  cfg=json.loads(await asyncio.wait_for(websocket.receive_text(),15)); sr=int(cfg.get('sampleRate',16000)); window=max(MIN_WINDOW,float(cfg.get('windowSeconds',MIN_WINDOW)))
  if sr<8000 or sr>48000: sr=16000
  await websocket.send_text('Loading OpenVoice V2 ONNX engine...'); await ensure_engine(); await websocket.send_text(f'OpenVoice V2 ready. Window: {window:.3f}s')
  buf=bytearray(); target_bytes=int(sr*window*2)
  while True:
   try: msg=await asyncio.wait_for(websocket.receive(),30)
   except asyncio.TimeoutError:
    try: await websocket.send_text('KEEPALIVE')
    except Exception: break
    continue
   if msg.get('type')=='websocket.disconnect': break
   if msg.get('bytes') is None: continue
   buf.extend(msg['bytes'])
   while len(buf)>=target_bytes:
    chunk=bytes(buf[:target_bytes]); del buf[:target_bytes]
    async with lock:
     try:
      data=await asyncio.to_thread(convert_chunk,chunk,sr)
      if data: await websocket.send_bytes(data)
     except Exception as e:
      try: await websocket.send_text('Conversion error: '+str(e))
      except Exception: break
 except (WebSocketDisconnect, asyncio.CancelledError): pass
 except Exception: pass
