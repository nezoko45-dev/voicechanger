from pathlib import Path
import os, tempfile
import librosa, numpy as np, soundfile as sf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

ROOT = Path(__file__).resolve().parent
CHECKPOINTS = Path(os.environ.get('OPENVOICE_CHECKPOINT_DIR', ROOT / 'checkpoints_v2'))
OUT = ROOT / 'outputs'
OUT.mkdir(exist_ok=True)
app = FastAPI(title='VoiceChanger Local API')
app.add_middleware(CORSMiddleware, allow_origin_regex=r'chrome-extension://.*', allow_methods=['GET','POST'], allow_headers=['*'])

@app.get('/health')
def health():
    ready = (CHECKPOINTS/'converter'/'config.json').exists() and (CHECKPOINTS/'converter'/'checkpoint.pth').exists()
    return {'ok': True, 'converter_ready': ready, 'message': 'OpenVoice V2 checkpoints ready.' if ready else 'API online. Install official OpenVoice V2 package and converter checkpoints; see README.md.'}

def load_converter():
    config, ckpt = CHECKPOINTS/'converter'/'config.json', CHECKPOINTS/'converter'/'checkpoint.pth'
    if not config.exists() or not ckpt.exists():
        raise HTTPException(503, 'OpenVoice V2 checkpoints missing. Follow README.md and the official OpenVoice setup instructions.')
    try:
        from openvoice.api import ToneColorConverter
        import torch
        device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
        converter = ToneColorConverter(str(config), device=device)
        converter.load_ckpt(str(ckpt))
        return converter, device
    except ImportError as exc:
        raise HTTPException(503, 'OpenVoice package not installed. Follow https://github.com/myshell-ai/OpenVoice') from exc

@app.post('/convert')
async def convert(audio: UploadFile = File(...), reference: UploadFile = File(...)):
    audio_bytes, ref_bytes = await audio.read(), await reference.read()
    if not audio_bytes or not ref_bytes: raise HTTPException(400, 'Choose a captured clip and reference WAV.')
    if len(audio_bytes)>80*1024*1024 or len(ref_bytes)>80*1024*1024: raise HTTPException(413, 'Files must be under 80 MB.')
    if Path(reference.filename or 'ref.wav').suffix.lower() not in ('.wav','.wave'): raise HTTPException(400, 'Reference must be WAV.')
    with tempfile.TemporaryDirectory(prefix='voicechanger-') as tmp:
        tmp=Path(tmp); source_path=tmp/'capture.webm'; ref_path=tmp/'reference.wav'
        source_path.write_bytes(audio_bytes); ref_path.write_bytes(ref_bytes)
        try:
            source,_=librosa.load(source_path,sr=24000,mono=True); ref,_=librosa.load(ref_path,sr=24000,mono=True)
        except Exception as exc: raise HTTPException(400, f'Could not decode audio. Install FFmpeg and check the WAV. {exc}') from exc
        if source.size<2400 or ref.size<2400: raise HTTPException(400, 'Capture and reference must each contain at least 0.1 seconds of audio.')
        if not np.isfinite(source).all() or not np.isfinite(ref).all(): raise HTTPException(400, 'Audio contains invalid sample values.')
        converter,device=load_converter()
        try:
            from openvoice import se_extractor
            src=tmp/'source.wav'; target=tmp/'target.wav'
            sf.write(src,source,24000); sf.write(target,ref,24000)
            src_se,_=se_extractor.get_se(str(src),converter,vad=True)
            tgt_se,_=se_extractor.get_se(str(target),converter,vad=True)
            converter.convert(audio_src_path=str(src),src_se=src_se,tgt_se=tgt_se,output_path=str(OUT/'converted-latest.wav'),message='@VoiceChanger')
        except Exception as exc: raise HTTPException(500, f'OpenVoice conversion failed; verify its dependencies/checkpoints. {exc}') from exc
    return {'ok':True,'output':'/output','device':device,'sample_rate':24000}

@app.get('/output')
def output():
    path=OUT/'converted-latest.wav'
    if not path.exists(): raise HTTPException(404,'No converted audio yet.')
    return FileResponse(path,media_type='audio/wav',filename='voicechanger-output.wav')

if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=8765,log_level='info')