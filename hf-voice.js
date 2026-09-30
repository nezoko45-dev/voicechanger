import { KokoroTTS } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';

const $ = id => document.getElementById(id);
const voiceSel = $('voice'), micSel = $('mic'), outSel = $('output');
const choose = $('choose'), loadBtn = $('load'), stopBtn = $('stop');
const status = $('status'), meter = $('meter');
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let tts=null, recognition=null, running=false, ctx=null, currentAudio=null, speaking=false, queue=[];
function setStatus(s){status.textContent=s;}
async function devices(){
  if(!navigator.mediaDevices?.enumerateDevices)return;
  try{const ds=await navigator.mediaDevices.enumerateDevices(),mi=micSel.value,ou=outSel.value;
    micSel.innerHTML='<option value="">Default microphone</option>'; outSel.innerHTML='<option value="">Default output</option>';
    ds.filter(d=>d.kind==='audioinput').forEach((d,i)=>micSel.append(new Option(d.label||`Microphone ${i+1}`,d.deviceId)));
    ds.filter(d=>d.kind==='audiooutput').forEach((d,i)=>outSel.append(new Option(d.label||`Speaker ${i+1}`,d.deviceId)));
    if([...micSel.options].some(o=>o.value===mi))micSel.value=mi;if([...outSel.options].some(o=>o.value===ou))outSel.value=ou;
  }catch(e){console.warn(e);}
}
async function ensureContext(){if(!ctx)ctx=new AudioContext({latencyHint:'interactive'});await ctx.resume();if(ctx.setSinkId&&outSel.value)try{await ctx.setSinkId(outSel.value);}catch(e){console.warn(e);}}
async function chooseOutput(){if(!navigator.mediaDevices?.selectAudioOutput){setStatus('Chrome does not expose speaker selection here. Use the system default output.');return;}try{const d=await navigator.mediaDevices.selectAudioOutput();if(d)outSel.value=d.deviceId;await ensureContext();}catch(e){if(e.name!=='NotAllowedError')setStatus('Speaker selection: '+e.message);}}
async function loadVoice(){if(tts)return;loadBtn.disabled=true;try{setStatus('Loading Kokoro locally…');meter.style.width='15%';tts=await KokoroTTS.from_pretrained(MODEL,{dtype:'q8',device:'wasm',progress_callback:p=>{if(p?.progress!=null)meter.style.width=Math.max(15,Math.min(100,p.progress))+'%';}});meter.style.width='100%';setStatus('Kokoro loaded. Press START and speak.');}catch(e){console.error(e);tts=null;loadBtn.disabled=false;setStatus('Model load failed: '+(e?.message||e));throw e;}}
function playAudio(audio,sampleRate){return new Promise(async(resolve,reject)=>{try{await ensureContext();const data=audio instanceof Float32Array?audio:new Float32Array(audio);const buffer=ctx.createBuffer(1,data.length,sampleRate);buffer.copyToChannel(data,0);const src=ctx.createBufferSource();src.buffer=buffer;src.connect(ctx.destination);currentAudio=src;speaking=true;src.onended=()=>{speaking=false;currentAudio=null;resolve();processQueue();};src.start();}catch(e){reject(e);}});}
async function processQueue(){if(!tts||speaking||!queue.length||!running)return;const text=queue.shift();try{setStatus('Speaking: '+text);const result=await tts.generate(text,{voice:voiceSel.value,speed:1.0});await playAudio(result.audio,result.sampling_rate);}catch(e){speaking=false;setStatus('TTS error: '+(e?.message||e));processQueue();}}
function startRecognition(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){setStatus('This Chrome build does not provide SpeechRecognition.');return;}recognition=new SR();recognition.continuous=true;recognition.interimResults=true;recognition.lang='en-US';recognition.maxAlternatives=1;recognition.onstart=()=>setStatus('Listening… speak normally.');recognition.onerror=e=>{if(e.error!=='no-speech'&&e.error!=='aborted')setStatus('Speech recognition: '+e.error);};recognition.onend=()=>{if(running)try{recognition.start();}catch{}};recognition.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++){const r=e.results[i];if(r.isFinal){const text=r[0].transcript.trim();if(text){queue.push(text);meter.style.width='70%';processQueue();}}}};try{recognition.start();}catch{}}
async function start(){if(running)return;try{if(!tts)await loadVoice();const constraints={audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}};if(micSel.value)constraints.audio.deviceId={exact:micSel.value};const stream=await navigator.mediaDevices.getUserMedia(constraints);stream.getTracks().forEach(t=>t.stop());await devices();await ensureContext();running=true;queue=[];startRecognition();loadBtn.textContent='RUNNING';loadBtn.disabled=true;setStatus('Listening…');}catch(e){console.error(e);running=false;setStatus('Start error: '+(e?.message||e));}}
function stop(){running=false;queue=[];try{recognition?.stop();}catch{}recognition=null;try{currentAudio?.stop();}catch{}currentAudio=null;speaking=false;loadBtn.disabled=false;loadBtn.textContent='LOAD VOICE';setStatus('Stopped.');}
loadBtn.onclick=()=>void start();stopBtn.onclick=stop;choose.onclick=()=>void chooseOutput();outSel.onchange=()=>void ensureContext();navigator.mediaDevices?.addEventListener?.('devicechange',devices);void devices();