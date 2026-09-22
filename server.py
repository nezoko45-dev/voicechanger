import os,tempfile
from pathlib import Path
from fastapi import FastAPI,UploadFile,File,Request,HTTPException
from fastapi.responses import FileResponse,Response,HTMLResponse
import soundfile as sf
import numpy as np
import torch
from openvoice import se_extractor
from openvoice.api import ToneColorConverter
ROOT=Path(__file__).parent
CHECKPOINTS=Path(os.getenv("OPENVOICE_CHECKPOINTS","checkpoints_v2"))
CONVERTER=CHECKPOINTS/"converter"
BASE_SE=CHECKPOINTS/"base_speakers"/"ses"/"en-us.pth"
DEVICE="cuda:0" if torch.cuda.is_available() else "cpu"
app=FastAPI();converter=None;target_se=None
def init_openvoice():
 global converter
 if converter is not None:return
 if not (CONVERTER/"config.json").exists() or not (CONVERTER/"checkpoint.pth").exists():raise RuntimeError("Missing OpenVoice V2 converter files in checkpoints_v2/converter.")
 converter=ToneColorConverter(str(CONVERTER/"config.json"),device=DEVICE);converter.load_ckpt(str(CONVERTER/"checkpoint.pth"))
@app.get("/")
def root():return HTMLResponse((ROOT/"index.html").read_text(encoding="utf-8"))
@app.get("/app.js")
def js():return Response((ROOT/"app.js").read_text(encoding="utf-8"),media_type="application/javascript")
@app.get("/api/health")
def health():return {"ok":True,"openvoice_loaded":converter is not None,"reference_loaded":target_se is not None,"device":DEVICE}
@app.post("/api/reference")
async def reference(reference:UploadFile=File(...)):
 global target_se
 try:init_openvoice()
 except Exception as e:raise HTTPException(500,str(e))
 data=await reference.read()
 if len(data)<2048:raise HTTPException(400,"Reference WAV is too small.")
 with tempfile.NamedTemporaryFile(suffix=".wav",delete=False) as f:f.write(data);path=f.name
 try:target_se,_=se_extractor.get_se(path,converter,target_dir=str(ROOT/"processed"),vad=True)
 except Exception as e:raise HTTPException(500,"OpenVoice reference extraction failed: "+str(e))
 finally:
  try:os.remove(path)
  except OSError:pass
 return {"ok":True}
@app.post("/api/convert")
async def convert(request:Request):
 if target_se is None:raise HTTPException(400,"Load a reference voice first.")
 pcm=await request.body()
 if len(pcm)<1000:raise HTTPException(400,"TTS audio is empty.")
 audio=np.frombuffer(pcm,dtype=np.int16).astype(np.float32)/32768.0
 with tempfile.NamedTemporaryFile(suffix=".wav",delete=False) as src,tempfile.NamedTemporaryFile(suffix=".wav",delete=False) as out:
  src_path,out_path=src.name,out.name
 try:
  sf.write(src_path,audio,22050,subtype="PCM_16")
  if not BASE_SE.exists():raise RuntimeError("Missing checkpoints_v2/base_speakers/ses/en-us.pth")
  source_se=torch.load(BASE_SE,map_location=DEVICE)
  converter.convert(audio_src_path=src_path,src_se=source_se,tgt_se=target_se,output_path=out_path,message="@MyShell")
  return FileResponse(out_path,media_type="audio/wav",filename="cloned.wav")
 except Exception as e:raise HTTPException(500,"OpenVoice conversion failed: "+str(e))
 finally:
  try:os.remove(src_path)
  except OSError:pass
