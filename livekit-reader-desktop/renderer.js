const $=id=>document.getElementById(id);
let recognition=null,recognizing=false,audioUrl=null;
function status(s){$('status').textContent=s}
async function refreshCredentials(){const s=await window.voiceReader.credentialsStatus();$('secureState').textContent=s.secure?(s.saved?'Credentials saved securely':'Windows secure storage ready'):'Secure storage unavailable';$('secureState').style.color=s.secure?'#9fddb9':'#ff9b9b'}
$('saveKeys').onclick=async()=>{try{await window.voiceReader.saveCredentials({apiKey:$('apiKey').value,apiSecret:$('apiSecret').value});$('apiKey').value='';$('apiSecret').value='';await refreshCredentials();status('LiveKit credentials encrypted and saved on this PC.')}catch(e){status(e.message)}};
$('clearKeys').onclick=async()=>{await window.voiceReader.clearCredentials();await refreshCredentials();status('Saved credentials forgotten.')};
$('speed').oninput=()=>$('speedValue').textContent=Number($('speed').value).toFixed(2)+'×';
function stopMic(){if(recognition){recognition.onend=null;recognition.stop();recognition=null}recognizing=false;$('micState').textContent='Microphone idle';$('startMic').disabled=false;$('stopMic').disabled=true}
$('startMic').onclick=()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){status('Speech recognition is unavailable in this Windows build. You can still type text and use neural read-aloud.');return}
 recognition=new SR();recognition.lang='en-US';recognition.continuous=true;recognition.interimResults=true;
 recognition.onstart=()=>{recognizing=true;$('micState').textContent='Listening to microphone';$('startMic').disabled=true;$('stopMic').disabled=false;status('Listening… speak into your microphone.')};
 recognition.onresult=e=>{let final='';for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)final+=e.results[i][0].transcript+' '}if(final)$('text').value+=($('text').value?' ':'')+final.trim()};
 recognition.onerror=e=>status('Microphone recognition: '+e.error);
 recognition.onend=()=>{if(recognizing){try{recognition.start()}catch{}}else stopMic()};recognition.start()};
$('stopMic').onclick=()=>{recognizing=false;stopMic();status('Microphone stopped.')};
$('read').onclick=async()=>{try{if(!($('text').value||'').trim())return status('Enter or dictate some text first.');$('read').disabled=true;status('Generating Fish Audio neural speech…');const base64=await window.voiceReader.synthesize({text:$('text').value,voice:$('voice').value,speed:$('speed').value});const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const blob=new Blob([bytes],{type:'audio/wav'});if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=URL.createObjectURL(blob);$('player').src=audioUrl;await $('player').play();$('pause').disabled=false;$('stop').disabled=false;status('Playing Fish Audio neural voice.')}catch(e){status(e.message||'Speech generation failed.')}finally{$('read').disabled=false}};
$('pause').onclick=()=>{const p=$('player');if(p.paused){p.play();$('pause').textContent='Pause'}else{p.pause();$('pause').textContent='Resume'}};
$('stop').onclick=()=>{$('player').pause();$('player').currentTime=0;$('pause').disabled=true;$('stop').disabled=true;$('pause').textContent='Pause';status('Playback stopped.')};
$('player').onended=()=>{$('pause').disabled=true;$('stop').disabled=true;$('pause').textContent='Pause';status('Finished reading.')};
$('clear').onclick=()=>{$('text').value='';status('Text cleared.')};
refreshCredentials();
