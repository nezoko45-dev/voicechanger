const $ = id => document.getElementById(id);
const apiKey = $('apiKey');
const voiceUuid = $('voiceUuid');
const outputDevice = $('outputDevice');
const outputStatus = $('outputStatus');
const refreshAudioBtn = $('refreshAudio');
const chooseOutputBtn = $('chooseOutput');
const pitch = $('pitch');
const prompt = $('prompt');
const statusEl = $('status');
const transcriptEl = $('text');
const meterFill = $('meterFill');
const startBtn = $('start');
const testAudioBtn = $('testAudio');
const recordBtn = $('record');
const stopBtn = $('stop');
const player = $('player');

const PYTHON = 'http://127.0.0.1:17856';
let running = false;
let recording = false;
let recorder = null;
let stream = null;
let selectedOutput = 'default';

function setStatus(text){ statusEl.textContent = text; }

function setRunning(v){
  running = v;
  startBtn.disabled = v;
  testAudioBtn.disabled = !v;
  recordBtn.disabled = !v;
  stopBtn.disabled = !v;
}

async function python(path, options = {}){
  const response = await fetch(PYTHON + path, {
    ...options,
    headers: {'Content-Type':'application/json', ...(options.headers || {})}
  });
  const data = await response.json().catch(() => ({}));
  if(!response.ok) throw new Error(data.error || `Resemble bridge HTTP ${response.status}`);
  return data;
}

async function saveConfig(){
  const payload = {
    voice_uuid: voiceUuid.value.trim(),
    pitch: Number(pitch.value || 0),
    prompt: prompt.value.trim(),
    browser_output_device: selectedOutput || 'default'
  };
  if(apiKey.value.trim()) payload.api_key = apiKey.value.trim();
  return python('/config', {method:'POST', body:JSON.stringify(payload)});
}

async function loadConfig(){
  try{
    const data = await python('/config');
    if(data.voice_uuid) voiceUuid.value = data.voice_uuid;
    if(data.pitch !== undefined) pitch.value = data.pitch;
    if(data.prompt) prompt.value = data.prompt;
    if(data.api_key === 'configured') apiKey.placeholder = 'API key already configured locally';
    selectedOutput = data.browser_output_device || 'default';
  }catch{}
}

async function unlockAudio(){
  try{
    if(!player.src) player.src = 'data:audio/wav;base64,UklGRgAAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAABAAgAZGF0YQAAAAA=';
    if(typeof player.setSinkId === 'function' && selectedOutput && selectedOutput !== 'default') {
      await player.setSinkId(selectedOutput);
    }
  }catch(err){
    console.warn('Audio output unlock:', err);
  }
}

function labelForDevice(device){
  const label = device.label || 'Audio output';
  if(label.toLowerCase().includes('cable input')) return 'VB-CABLE — CABLE Input';
  return label;
}

async function loadAudioDevices(){
  if(!navigator.mediaDevices?.enumerateDevices) {
    outputStatus.textContent = 'This browser does not expose audio output selection.';
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter(d => d.kind === 'audiooutput');
  const previous = selectedOutput || 'default';

  outputDevice.innerHTML = '';
  outputDevice.add(new Option('Default Windows output', 'default'));

  outputs.forEach(device => {
    if(!device.deviceId) return;
    outputDevice.add(new Option(labelForDevice(device), device.deviceId));
  });

  const cable = outputs.find(d => /cable input|vb-audio cable|virtual audio cable/i.test(d.label || ''));
  if(previous !== 'default' && [...outputDevice.options].some(o => o.value === previous)) {
    outputDevice.value = previous;
  } else if(previous === 'default') {
    outputDevice.value = 'default';
  } else if(cable) {
    outputDevice.value = cable.deviceId;
    selectedOutput = cable.deviceId;
  }

  selectedOutput = outputDevice.value || 'default';
  outputStatus.textContent = `Browser TTS output: ${outputDevice.selectedOptions[0]?.text || 'Default Windows output'}`;
  await applySink();
}

async function applySink(){
  selectedOutput = outputDevice.value || 'default';
  try{
    if(typeof player.setSinkId === 'function') {
      await player.setSinkId(selectedOutput === 'default' ? '' : selectedOutput);
    }
    outputStatus.textContent = `Browser TTS output: ${outputDevice.selectedOptions[0]?.text || 'Default Windows output'}`;
    await saveConfig();
  }catch(err){
    outputStatus.textContent = `Could not select that output: ${err.message}`;
    setStatus('Audio output selection failed');
  }
}

async function chooseOutput(){
  try{
    if(typeof navigator.mediaDevices.selectAudioOutput !== 'function') {
      await loadAudioDevices();
      setStatus('Choose an output from the list');
      return;
    }
    const device = await navigator.mediaDevices.selectAudioOutput();
    if(device?.deviceId) {
      selectedOutput = device.deviceId;
      await loadAudioDevices();
      outputDevice.value = device.deviceId;
      await applySink();
      setStatus(`Output selected: ${device.label || 'Windows audio device'}`);
    }
  }catch(err){
    setStatus('Output chooser: ' + err.message);
  }
}

async function playResembleAudio(base64, mime = 'audio/wav'){
  if(!base64) throw new Error('Resemble returned no audio data.');

  const byteCharacters = atob(base64);
  const bytes = new Uint8Array(byteCharacters.length);
  for(let i = 0; i < byteCharacters.length; i++) bytes[i] = byteCharacters.charCodeAt(i);

  const blob = new Blob([bytes], {type:mime});
  const url = URL.createObjectURL(blob);
  try{
    if(typeof player.setSinkId === 'function') {
      await player.setSinkId(selectedOutput === 'default' ? '' : selectedOutput);
    }
    player.src = url;
    player.currentTime = 0;
    await player.play();
    await new Promise(resolve => {
      const done = () => { player.removeEventListener('ended', done); resolve(); };
      player.addEventListener('ended', done);
      setTimeout(() => { player.removeEventListener('ended', done); resolve(); }, 30000);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadVoices(){
  setStatus('Loading your Resemble custom voice library…');
  const data = await python('/voices');
  const previous = voiceUuid.value;
  voiceUuid.innerHTML = '';
  const voices = data.voices || [];
  if(!voices.length) throw new Error('No Resemble voices were returned for this account.');

  voices.forEach(v => {
    voiceUuid.add(new Option(`${v.name || 'Unnamed'} — ${v.uuid || ''}`, v.uuid || ''));
  });
  if(previous && [...voiceUuid.options].some(o => o.value === previous)) voiceUuid.value = previous;
  if(!voiceUuid.value && voices[0]?.uuid) voiceUuid.value = voices[0].uuid;
  await saveConfig();
}

async function connect(){
  try{
    setRunning(false);
    setStatus('Requesting browser audio permission…');

    // Opening the microphone once exposes useful device labels, including virtual cables.
    const permissionStream = await navigator.mediaDevices.getUserMedia({audio:true});
    permissionStream.getTracks().forEach(t => t.stop());

    await loadConfig();
    await loadAudioDevices();
    await unlockAudio();
    await saveConfig();
    await loadVoices();

    if(!voiceUuid.value.trim()) throw new Error('No Resemble custom voice is selected.');

    setStatus('Starting Resemble Audio API…');
    const started = await python('/start', {method:'POST', body:'{}'});
    setRunning(true);
    setStatus(started.status || 'Resemble Audio API ready');
    transcriptEl.textContent = 'Connected. Press Test Resemble Audio before using the microphone.';
    meterFill.style.width = '20%';
  }catch(err){
    setRunning(false);
    setStatus('Connection error: ' + err.message);
    transcriptEl.textContent = err.message;
  }
}

async function testAudio(){
  if(!running) return;
  try{
    await saveConfig();
    await unlockAudio();
    setStatus('Resemble Audio API: generating test voice…');
    meterFill.style.width = '55%';
    const response = await python('/tts', {
      method:'POST',
      body:JSON.stringify({text:'Hello! This is the Resemble audio output test.'})
    });
    await playResembleAudio(response.audio_base64, response.mime);
    meterFill.style.width = '100%';
    setStatus('Test audio played successfully');
    transcriptEl.textContent = 'If you heard the test, the Resemble audio path works. If CABLE Input is selected, the test is being sent into the virtual cable.';
  }catch(err){
    meterFill.style.width = '0%';
    setStatus('Audio test failed: ' + err.message);
    transcriptEl.textContent = err.message;
  }
}

function pickMime(){
  const choices = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];
  return choices.find(x => MediaRecorder.isTypeSupported(x)) || '';
}

async function startVoiceChanger(){
  if(!running || recording) return;
  try{
    await saveConfig();
    await unlockAudio();
    stream = await navigator.mediaDevices.getUserMedia({
      audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}
    });

    const mime = pickMime();
    recorder = mime ? new MediaRecorder(stream,{mimeType:mime}) : new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };

    recorder.onstop = async () => {
      const type = recorder.mimeType || mime || 'audio/webm';
      const blob = new Blob(chunks,{type});
      chunks.length = 0;
      try{
        setStatus('Resemble STT: transcribing…');
        transcriptEl.textContent = 'Listening finished — sending your speech to Resemble…';
        meterFill.style.width = '55%';

        const response = await fetch(PYTHON + '/stt-tts', {
          method:'POST',
          headers:{'Content-Type':type,'X-Audio-Type':type},
          body:blob
        });
        const data = await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(data.error || `Voice changer HTTP ${response.status}`);

        transcriptEl.textContent = data.text || '(No speech recognized)';
        setStatus('Resemble Audio API: playing converted voice…');
        await playResembleAudio(data.audio_base64, data.mime || 'audio/wav');
        meterFill.style.width = '100%';
        setStatus('Ready — converted voice played');
      }catch(err){
        setStatus('Voice changer error: ' + err.message);
        transcriptEl.textContent = err.message;
        meterFill.style.width = '0%';
      }
      if(recording && running) setStatus('Ready — press Start Voice Changer for the next sentence');
    };

    recorder.start();
    recording = true;
    recordBtn.textContent = 'Stop Listening';
    meterFill.style.width = '30%';
    setStatus('Listening… speak now');
    transcriptEl.textContent = 'Listening to your microphone…';
  }catch(err){
    setStatus('Microphone error: ' + err.message);
  }
}

function stopListening(){
  if(!recording || !recorder) return;
  recorder.stop();
  recording = false;
  recordBtn.textContent = 'Start Voice Changer';
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
}

async function stop(){
  stopListening();
  try{ await python('/stop', {method:'POST', body:'{}'}); }catch(err){ setStatus(err.message); }
  setRunning(false);
  meterFill.style.width = '0%';
  setStatus('Stopped');
}

startBtn.onclick = connect;
testAudioBtn.onclick = testAudio;
recordBtn.onclick = () => recording ? stopListening() : startVoiceChanger();
stopBtn.onclick = stop;
chooseOutputBtn.onclick = chooseOutput;
refreshAudioBtn.onclick = async () => {
  try{
    await loadAudioDevices();
    setStatus('Browser audio outputs refreshed');
  }catch(err){
    setStatus('Audio output error: ' + err.message);
  }
};
voiceUuid.onchange = saveConfig;
outputDevice.onchange = applySink;
pitch.onchange = saveConfig;
prompt.onchange = saveConfig;

(async()=>{
  setRunning(false);
  await loadConfig();
  try{ await loadAudioDevices(); }catch{}
})();
