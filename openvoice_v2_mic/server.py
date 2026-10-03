import asyncio, json, os, tempfile, uuid
from pathlib import Path
import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, UploadFile, WebSocket
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from voiceclonnx import VoiceCloner

ROOT = Path(__file__).resolve().parent
VOICE_DIR = ROOT / 'voices'
VOICE_DIR.mkdir(exist_ok=True)
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

cloner = None
reference = None
lock = asyncio.Lock()

@app.get('/')
def index():
    return FileResponse(ROOT / 'index.html')

@app.get('/health')
def health():
    return {'ok': True, 'engine': 'openvoice-v2'}

@app.post('/reference')
async def reference_upload(file: UploadFile = File(...)):
    global reference
    data = await file.read()
    p = VOICE_DIR / ('reference_' + uuid.uuid4().hex + '.wav')
    p.write_bytes(data)
    reference = p
    return {'ok': True, 'reference': p.name}

def convert_chunk(pcm16: bytes, sample_rate: int):
    global cloner, reference
    if reference is None:
        raise RuntimeError('No reference WAV selected')
    audio = np.frombuffer(pcm16, dtype='<i2').astype(np.float32) / 32768.0
    if audio.size < int(sample_rate * 0.8):
        return None
    src = Path(tempfile.mkstemp(suffix='.wav', dir=VOICE_DIR)[1])
    out = Path(tempfile.mkstemp(suffix='.wav', dir=VOICE_DIR)[1])
    try:
        sf.write(src, audio, sample_rate, subtype='PCM_16')
        # voiceclonnx's OpenVoice engine performs audio-to-audio tone-color conversion.
        result = cloner.clone_voice(str(src), str(reference), str(out))
        # clone_voice may return a path or None depending on version.
        out_path = Path(result) if result else out
        if not out_path.exists():
            raise RuntimeError('OpenVoice returned no output WAV')
        return out_path.read_bytes()
    finally:
        try: src.unlink()
        except: pass
        if out.exists() and out != Path(result) if 'result' in locals() and result else True:
            pass

@app.websocket('/ws')
async def ws(websocket: WebSocket):
    await websocket.accept()
    try:
        cfg = json.loads(await websocket.receive_text())
        sr = int(cfg.get('sampleRate', 16000))
        await websocket.send_text('Loading OpenVoice V2 ONNX engine… first run downloads the model.')
        global cloner
        if cloner is None:
            cloner = VoiceCloner(engine='openvoice', quantized=False)
        await websocket.send_text('OpenVoice V2 ready. Speak into the microphone.')
        buf = bytearray()
        target_bytes = int(sr * 1.5 * 2)
        while True:
            msg = await websocket.receive()
            if 'bytes' not in msg or msg['bytes'] is None:
                continue
            buf.extend(msg['bytes'])
            while len(buf) >= target_bytes:
                chunk = bytes(buf[:target_bytes]); del buf[:target_bytes]
                async with lock:
                    try:
                        data = await asyncio.to_thread(convert_chunk, chunk, sr)
                        if data: await websocket.send_bytes(data)
                    except Exception as e:
                        await websocket.send_text('Conversion error: ' + str(e))
    except Exception as e:
        try: await websocket.send_text('Server error: ' + str(e))
        except: pass
