(()=>{
 if(window.__caiAutomationLoaded)return;window.__caiAutomationLoaded=true;
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 let active=false,recognition=null,busy=false,restartTimer=null,monitorTimer=null,submitLock=false,audioWasPlaying=false,lastRecoveryClick=0;
 const log=s=>{console.log("[CAI Voice Automation]",s);try{chrome.runtime.sendMessage({type:"STATUS",text:s}).catch(()=>{})}catch{}};
 const input=()=>document.querySelector('textarea[placeholder],textarea')||document.querySelector('[contenteditable="true"][role="textbox"]')||document.querySelector('[contenteditable="true"]');
 function setText(el,text){el.focus();if(el instanceof HTMLTextAreaElement)Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,text);else el.textContent=text;el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}))}
 function sendMessage(){const el=input();if(!el)return false;const b=[...document.querySelectorAll("button")].find(x=>/send/i.test((x.getAttribute("aria-label")||"")+" "+(x.title||""))&&!x.disabled);if(b){b.click();return true}el.focus();el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}));el.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",code:"Enter",bubbles:true}));return true}
 // Locate the voice playback control robustly (CAI's SVG often has no useful aria label).
 function voiceWaveButton(){
  return [...document.querySelectorAll("button")].find(b=>{
   if(b.disabled||/send|submit/i.test((b.getAttribute("aria-label")||"")+" "+(b.title||"")))return false;
   const label=((b.getAttribute("aria-label")||"")+" "+(b.title||"")+" "+(b.getAttribute("data-testid")||"")+" "+(b.textContent||"")).toLowerCase();
   const svg=b.querySelector("svg");
   return !!svg && (/voice|audio|wave|speak|sound|listen|call|play|pause/.test(label) ||
     /wave|audio|voice|sound|play|pause/i.test(svg.getAttribute("data-testid")||"") ||
     b.hasAttribute("aria-pressed"));
  });
 }
 // Track both media elements and CAI's playback button state/DOM changes.
 let audioMonitorObserver=null, audioStateSignature="";
 function playbackState(){
  const media=[...document.querySelectorAll("audio,video")];
  const mediaOn=media.some(a=>!a.paused&&!a.ended&&a.currentTime>0);
  const b=voiceWaveButton();
  const label=((b?.getAttribute("aria-label")||"")+" "+(b?.title||"")+" "+(b?.getAttribute("data-testid")||"")).toLowerCase();
  const pressed=b?.getAttribute("aria-pressed")==="true";
  const playingLabel=/pause|stop audio|playing/.test(label);
  return mediaOn||pressed||playingLabel;
 }
 function monitorVoice(){
  if(!active)return;
  const playing=playbackState();
  if(playing){if(!audioWasPlaying)log("Character.AI playback detected; holding recovery clicks.");audioWasPlaying=true;return}
  if(audioWasPlaying){audioWasPlaying=false;lastRecoveryClick=Date.now();log("Character.AI playback ended; waiting 8 seconds before recovery.");return}
  if(Date.now()-lastRecoveryClick<8000)return;
  const b=voiceWaveButton();
  if(b){b.click();lastRecoveryClick=Date.now();log("Tapped CAI voice-wave control; recovery cooldown started.")}
  else log("CAI voice-wave control not found; checking again in 1 second.");
 }
 function startAudioMonitor(){
  clearInterval(monitorTimer);monitorTimer=setInterval(monitorVoice,1000);
  if(audioMonitorObserver)audioMonitorObserver.disconnect();
  audioMonitorObserver=new MutationObserver(()=>{if(!active)return;const state=playbackState();const sig=state?"playing":"idle";if(sig!==audioStateSignature){audioStateSignature=sig;if(state){audioWasPlaying=true;log("CAI audio state changed to playing.")}else if(audioWasPlaying){audioWasPlaying=false;log("CAI audio state changed to finished.")}}});
  audioMonitorObserver.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["aria-label","aria-pressed","title","data-testid"]});
 }
 function startRecognition(){
  if(!active||recognition||!SR)return;clearTimeout(restartTimer);
  try{const r=new SR();recognition=r;r.lang="en-US";r.continuous=true;r.interimResults=false;r.maxAlternatives=1;
   r.onstart=()=>log("Continuous mic listening.");
   r.onerror=e=>{log("Speech error: "+e.error);if(e.error==="not-allowed"||e.error==="service-not-allowed"){active=false;recognition=null;clearInterval(monitorTimer);return}};
   r.onresult=e=>{if(!active||busy||submitLock)return;let phrase="";for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)phrase+=e.results[i][0].transcript+" ";phrase=phrase.trim();if(phrase){submitLock=true;log("Heard: "+phrase);submit(phrase)}};
   r.onend=()=>{if(recognition===r)recognition=null;if(active&&!busy)restartTimer=setTimeout(startRecognition,450)};
   r.start();
  }catch(e){recognition=null;log("Recognition start error: "+e.message);restartTimer=setTimeout(startRecognition,900)}
 }
 function submit(text){
  busy=true;const r=recognition;recognition=null;try{r?.stop()}catch{}
  const el=input();if(!el){busy=false;submitLock=false;log("Chat input not found; continuing listening.");restartTimer=setTimeout(startRecognition,500);return}
  setText(el,text);
  setTimeout(()=>{if(!active)return;if(!sendMessage()){busy=false;submitLock=false;log("Send failed; continuing listening.");restartTimer=setTimeout(startRecognition,500);return}
   log("Sent: "+text);busy=false;submitLock=false;startRecognition();
  },250);
 }
 function start(){if(!SR){log("SpeechRecognition unavailable. Use Chrome.");return}active=true;busy=false;submitLock=false;lastRecoveryClick=Date.now();startRecognition();startAudioMonitor();log("Continuous mic + 1-second audio checks; 8-second recovery clicks enabled.")}
 function stop(){active=false;busy=false;submitLock=false;clearTimeout(restartTimer);clearInterval(monitorTimer);audioMonitorObserver?.disconnect();audioMonitorObserver=null;try{recognition?.stop()}catch{}recognition=null;audioWasPlaying=false;log("Stopped listening.")}
 chrome.runtime.onMessage.addListener(m=>{if(m.action==="START")start();if(m.action==="STOP")stop()});
})();