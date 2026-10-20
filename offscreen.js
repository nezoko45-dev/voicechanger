(() => {
 let recognition=null,listening=false,starting=false,finalText="",interimText="",silenceTimer=null,restartTimer=null,restartCount=0,previewAt=0,lastSubmitKey="",lastSubmitAt=0,submitInFlight=false;
 const SpeechRecognition=self.SpeechRecognition||self.webkitSpeechRecognition;
 const status=message=>chrome.runtime.sendMessage({type:"IVD_OFFSCREEN_STATUS",listening,message}).catch(()=>{});
 async function sendForGeneration(action,text){return await chrome.runtime.sendMessage({type:"IVD_BRIDGE_TO_ZALT",action,text});}
 async function preview(text){const phrase=String(text||"").trim();if(!phrase)return;chrome.runtime.sendMessage({type:"IVD_OFFSCREEN_TRANSCRIPT",text:phrase}).catch(()=>{});const result=await sendForGeneration("preview",phrase);if(!result?.ok&&result?.message)status(result.message);}
 async function submit(text){
  const phrase=String(text||"").replace(/\s+/g," ").trim();if(!phrase)return;
  const key=phrase.toLocaleLowerCase();
  const now=Date.now();
  // Silence flush and SpeechRecognition.onend can report the same utterance close together.
  // Suppress an identical repeat here as a second guard before it reaches the page.
  if(submitInFlight||(key===lastSubmitKey&&now-lastSubmitAt<10000)){status("Duplicate transcript suppressed; generating this utterance only once.");return;}
  lastSubmitKey=key;lastSubmitAt=now;submitInFlight=true;
  try{const result=await sendForGeneration("generate",phrase);if(!result?.ok)status("Transcript captured but tts.dev did not accept it: "+(result?.message||"Refresh the tts.dev tab."));else status(result?.message||"Sent to tts.dev. Dictation remains active.");}
  finally{submitInFlight=false;}
 }
 async function autoGenerateEnabled(){try{const data=await chrome.storage.local.get(["autoGenerate"]);return typeof data.autoGenerate==="boolean"?data.autoGenerate:true;}catch{return true;}}
 function flush(){clearTimeout(silenceTimer);const text=[finalText,interimText].filter(Boolean).join(" ").replace(/\s+/g," ").trim();finalText="";interimText="";if(text){void preview(text);void autoGenerateEnabled().then(enabled=>{if(enabled)void submit(text);else status("Transcript captured. Auto-generate is off.");});}}
 function startRecognition(){if(!listening||!SpeechRecognition||recognition)return;const r=new SpeechRecognition();recognition=r;r.continuous=true;r.interimResults=true;r.lang="en-US";
  r.onstart=()=>{restartCount=0;status("Listening in background. You can switch to VRChat.");};
  r.onresult=event=>{let interim="";for(let i=event.resultIndex;i<event.results.length;i++){const phrase=event.results[i][0].transcript;if(event.results[i].isFinal)finalText+=phrase+" ";else interim+=phrase;}interimText=interim;const text=[finalText,interimText].filter(Boolean).join(" ").replace(/\s+/g," ").trim();if(text){if(Date.now()-previewAt>250){previewAt=Date.now();void preview(text);}clearTimeout(silenceTimer);silenceTimer=setTimeout(flush,3000);}};
  r.onerror=event=>{if(["not-allowed","service-not-allowed","audio-capture"].includes(event.error)){listening=false;clearTimeout(restartTimer);status(event.error==="audio-capture"?"Microphone unavailable. Check Windows Settings → System → Sound → Input and microphone permissions.":"Microphone permission denied. Allow microphone access for Chrome, then start again.");}else if(listening)status("Speech recognition interrupted ("+event.error+"); reconnecting in background…");};
  r.onend=()=>{if(recognition===r)recognition=null;if(!listening){flush();status("Dictation stopped.");return;}clearTimeout(silenceTimer);const completed=finalText.trim();finalText="";interimText="";if(completed){void preview(completed);void autoGenerateEnabled().then(enabled=>{if(enabled)void submit(completed);else status("Transcript captured. Auto-generate is off.");});}clearTimeout(restartTimer);restartCount++;status("Reconnecting microphone recognition in background…");restartTimer=setTimeout(()=>{if(listening&&!recognition)startRecognition();},Math.min(3000,250*restartCount));};
  try{r.start();}catch(e){recognition=null;listening=false;status("Couldn't start background speech recognition: "+(e?.message||e));}
 }
 async function toggle(){if(!SpeechRecognition){status("This Chrome build doesn't expose SpeechRecognition in its background document. Use current Chrome.");return{listening:false,message:"Background speech recognition isn't supported in this Chrome build."};}
  if(listening){listening=false;clearTimeout(restartTimer);clearTimeout(silenceTimer);if(recognition){try{recognition.stop();}catch{}}else flush();status("Stopping dictation…");return{listening:false,message:"Dictation stopping."};}
  if(starting)return{listening:false,message:"Dictation is already starting."};starting=true;
  try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const device=stream.getAudioTracks()[0]?.label||"default microphone";stream.getTracks().forEach(t=>t.stop());listening=true;status("Microphone ready ("+device+"). Starting background recognition…");startRecognition();return{listening:true,message:"Background dictation starting with "+device};}
  catch(e){listening=false;const message=e?.name==="NotAllowedError"?"Microphone access denied. Allow microphone access for Chrome/Windows and retry.":"Microphone unavailable: "+(e?.message||e);status(message);return{listening:false,message};}finally{starting=false;}
 }
 chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{if(message?.type!=="IVD_OFFSCREEN_TOGGLE")return;toggle().then(sendResponse);return true;});
})();
