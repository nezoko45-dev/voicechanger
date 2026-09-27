import os, json, time, threading, importlib.util, webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

ROOT=Path(__file__).resolve().parent
SEED=ROOT/"Seed-VC"; VOICE_DIR=ROOT/"voices"; VOICE_DIR.mkdir(exist_ok=True)
REF=VOICE_DIR/"female_reference.wav"; PORT=8765
state={"model":"loading","device":"unknown","running":False,"error":None,"inference_ms":0}
engine=None; seed=None

def load_seed():
    global seed
    os.chdir(SEED)
    spec=importlib.util.spec_from_file_location("seed_realtime",SEED/"real-time-gui.py")
    mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    import torch
    mod.device=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    mod.fp16=bool(torch.cuda.is_available())
    args=type("Args",(),{"checkpoint_path":None,"config_path":None,"fp16":mod.fp16})()
    state["device"]=str(mod.device); mod.model_set=mod.load_models(args); seed=mod; state["model"]="ready"

def convert_chunk(model_set,reference_wav,ref_name,input_wav_res,skip_head,skip_tail,return_length,steps,cfg,prompt,cd):
    import torch, torchaudio
    from contextlib import nullcontext
    sr=model_set[-1]["sampling_rate"]; hop=model_set[-1]["hop_size"]
    model,semantic,vocoder,camp,to_mel,_=model_set
    if getattr(seed,"prompt_condition",None) is None or seed.reference_wav_name!=ref_name or seed.prompt_len!=prompt:
        seed.prompt_len=prompt; reference_wav=reference_wav[:int(sr*prompt)]
        rt=torch.from_numpy(reference_wav).to(seed.device)
        r16=torchaudio.functional.resample(rt,sr,16000)
        s=semantic(r16.unsqueeze(0))
        f=torchaudio.compliance.kaldi.fbank(r16.unsqueeze(0),num_mel_bins=80,dither=0,sample_frequency=16000)
        f=f-f.mean(dim=0,keepdim=True); seed.style2=camp(f.unsqueeze(0))
        seed.mel2=to_mel(rt.unsqueeze(0)); n=torch.LongTensor([seed.mel2.size(2)]).to(seed.mel2.device)
        seed.prompt_condition=model.length_regulator(s,ylens=n,n_quantizers=3,f0=None)[0]
        seed.reference_wav_name=ref_name
    s=semantic(input_wav_res.unsqueeze(0)); diff=int(cd*50); s=s[:,diff:]
    n=torch.LongTensor([(skip_head+return_length+skip_tail-diff)/50*sr//hop]).to(s.device)
    cond=model.length_regulator(s,ylens=n,n_quantizers=3,f0=None)[0]
    cat=torch.cat([seed.prompt_condition,cond],dim=1)
    ctx=torch.autocast(device_type="cuda",dtype=torch.float16) if seed.device.type=="cuda" else nullcontext()
    with ctx:
        target=model.cfm.inference(cat,torch.LongTensor([cat.size(1)]).to(seed.mel2.device),seed.mel2,seed.style2,None,n_timesteps=steps,inference_cfg_rate=cfg)
        wave=vocoder(target[:,:,seed.mel2.size(-1):]).squeeze()
    out_len=return_length*sr//50; tail=skip_tail*sr//50
    return wave[-out_len-tail:-tail]

class RealtimeEngine:
    def __init__(self):
        self.stream=None
    def start(self,cfg):
        import numpy as np, torch, librosa, sounddevice as sd, torch.nn.functional as F
        if state["model"]!="ready": raise RuntimeError("Model is still loading.")
        self.stop(); self.model_set=seed.model_set
        if not REF.exists(): raise RuntimeError("Choose a female reference voice first.")
        self.reference,_=librosa.load(str(REF),sr=self.model_set[-1]["sampling_rate"],mono=True); self.ref_name=str(REF)
        self.sr=int(self.model_set[-1]["sampling_rate"]); self.block_time=float(cfg.get("block_time",.25))
        self.crossfade_time=float(cfg.get("crossfade",.04)); self.extra_ce=2.5; self.extra_time=.5; self.extra_right=.02
        self.steps=int(cfg.get("steps",8)); self.cfg=float(cfg.get("cfg",.7)); self.prompt=float(cfg.get("prompt",3))
        inp=int(cfg["input_device"]); out=int(cfg["output_device"]); ii=sd.query_devices(inp); oo=sd.query_devices(out)
        self.channels=max(1,min(int(ii["max_input_channels"]),int(oo["max_output_channels"]),2)); zc=self.sr//50
        self.block=int(round(self.block_time*self.sr/zc))*zc; self.block16=320*self.block//zc
        self.cross=max(zc,int(round(self.crossfade_time*self.sr/zc))*zc); self.sola=min(self.cross,4*zc); self.search=zc
        self.extra=int(round(self.extra_ce*self.sr/zc))*zc; self.right=int(round(self.extra_right*self.sr/zc))*zc
        total=self.extra+self.cross+self.search+self.block+self.right
        self.buf=torch.zeros(total,device=seed.device); self.buf16=torch.zeros(320*total//zc,device=seed.device)
        self.sola_buf=torch.zeros(self.sola,device=seed.device); self.skip_head=self.extra//zc; self.skip_tail=self.right//zc
        self.return_len=(self.block+self.sola+self.search)//zc
        self.fade_in=torch.sin(.5*np.pi*torch.linspace(0,1,self.sola,device=seed.device))**2; self.fade_out=1-self.fade_in
        sd.default.device=(inp,out)
        self.stream=sd.Stream(samplerate=self.sr,blocksize=self.block,channels=self.channels,dtype="float32",callback=self.callback,device=(inp,out))
        self.stream.start(); state["running"]=True; state["input_device"]=ii["name"]; state["output_device"]=oo["name"]
    def callback(self,indata,outdata,frames,times,status):
        import numpy as np, torch, librosa, torch.nn.functional as F
        try:
            mono=librosa.to_mono(indata.T)
            if len(mono)!=self.block: outdata.fill(0); return
            self.buf[:-self.block]=self.buf[self.block:].clone(); self.buf[-self.block:]=torch.from_numpy(mono).to(seed.device)
            self.buf16[:-self.block16]=self.buf16[self.block16:]
            r=librosa.resample(self.buf[-len(mono)-2*(self.sr//50):].detach().cpu().numpy(),orig_sr=self.sr,target_sr=16000)
            tail=torch.from_numpy(r[320:]).to(seed.device); n=self.block16
            if tail.numel()>=n: self.buf16[-n:]=tail[-n:]
            else: self.buf16[-tail.numel():]=tail
            if float(np.sqrt(np.mean(mono*mono)+1e-12))<.003: outdata.fill(0); return
            t=time.perf_counter()
            wav=convert_chunk(self.model_set,self.reference,self.ref_name,self.buf16,self.skip_head,self.skip_tail,self.return_len,self.steps,self.cfg,self.prompt,self.extra_ce-self.extra_time)
            corr=F.conv1d(wav[None,None,:self.sola+self.search],self.sola_buf[None,None,:]); den=torch.sqrt(F.conv1d(wav[None,None,:self.sola+self.search]**2,torch.ones(1,1,self.sola,device=seed.device))+1e-8)
            off=int(torch.argmax((corr[0,0]/den[0,0])).item()) if corr.numel()>1 else 0; wav=wav[off:]
            wav[:self.sola]*=self.fade_in; wav[:self.sola]+=self.sola_buf*self.fade_out; self.sola_buf[:]=wav[self.block:self.block+self.sola]
            out=wav[:self.block].detach().cpu().numpy(); outdata[:]=np.repeat(out[:,None],self.channels,axis=1)
            state["inference_ms"]=int((time.perf_counter()-t)*1000)
        except Exception as e: state["error"]=str(e); outdata.fill(0)
    def stop(self):
        if self.stream:
            try:self.stream.abort();self.stream.close()
            except Exception:pass
            self.stream=None
        state["running"]=False

def load_worker():
    try: load_seed()
    except Exception as e: state["model"]="error"; state["error"]=repr(e)

def devices():
    import sounddevice as sd
    return [{"index":i,"name":d["name"],"inputs":int(d["max_input_channels"]),"outputs":int(d["max_output_channels"]),"hostapi":sd.query_hostapis()[d["hostapi"]]["name"]} for i,d in enumerate(sd.query_devices())]

class Handler(BaseHTTPRequestHandler):
    def send_json(self,obj,code=200):
        raw=json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type","application/json"); self.send_header("Access-Control-Allow-Origin","*"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin","*"); self.send_header("Access-Control-Allow-Headers","Content-Type"); self.send_header("Access-Control-Allow-Methods","GET,POST,OPTIONS"); self.end_headers()
    def do_GET(self):
        if self.path=="/api/status": self.send_json(state); return
        if self.path=="/api/devices":
            try:self.send_json({"devices":devices()})
            except Exception as e:self.send_json({"error":str(e)},500)
            return
        files={"/":("index.html","text/html; charset=utf-8"),"/index.html":("index.html","text/html; charset=utf-8"),"/app.js":("app.js","application/javascript")}
        if self.path in files:
            fn,ct=files[self.path]; raw=(ROOT/fn).read_bytes(); self.send_response(200); self.send_header("Content-Type",ct); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw); return
        self.send_response(404); self.end_headers()
    def do_POST(self):
        n=int(self.headers.get("Content-Length","0")); body=self.rfile.read(n)
        if self.path=="/api/reference":
            REF.write_bytes(body); self.send_json({"ok":True}); return
        if self.path=="/api/start":
            try: engine.start(json.loads(body.decode() or "{}")); self.send_json({"ok":True})
            except Exception as e:self.send_json({"error":str(e)},500)
            return
        if self.path=="/api/stop": engine.stop(); self.send_json({"ok":True}); return
        self.send_json({"error":"not found"},404)

def main():
    global engine
    engine=RealtimeEngine(); threading.Thread(target=load_worker,daemon=True).start()
    srv=ThreadingHTTPServer(("127.0.0.1",PORT),Handler); print("VoiceChanger: http://127.0.0.1:8765")
    try:webbrowser.open("http://127.0.0.1:8765/")
    except Exception:pass
    srv.serve_forever()
if __name__=="__main__": main()
