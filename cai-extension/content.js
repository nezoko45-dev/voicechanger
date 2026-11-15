(()=>{
 if(window.__caiAutomationLoaded)return;window.__caiAutomationLoaded=true;
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 let active=false,recognition=null,busy=false,restartTimer=null,monitorTimer=null,submitLock=false,audioWasPlaying=false,lastRecoveryClick=0;
 const log=s=>console.log("[CAI Voice Automation]",s);
 const input=()=>document.querySelector('textarea[placeholder],textarea')||document.querySelector('[contenteditable="true"][role="textbox"]')||document.querySelector('[contenteditable="true"]');
 function setText(el,text){el.focus();if(el instanceof HTMLTextAreaElement)Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,text);else el.textContent=text;el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}))}
 function sendMessage(){const el=input();if(!el)return false;const b=[...document.querySelectorAll("button")].find(x=>/send/i.test((x.getAttribute("aria-label")||"")+" "+(x.title||""))&&!x.disabled);if(b){b.click();return true}el.focus();el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}));el.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",code:"Enter",bubbles:true}));return true}
 // Locate the voice playback control robustly (CAI's SVG often has no useful aria label).
 // Find the blue Read Aloud play triangle attached to the newest assistant reply.
 function replyReadAloudButton(){
  // CAI's reply playback control is the small blue triangular SVG shown below
  // assistant messages. Prefer explicit playback labels, then the blue triangle.
  const buttons=[...document.querySelectorAll("button,[role=button]")].filter(b=>!b.disabled);
  const labeled=buttons.filter(b=>/read aloud|listen|play audio|play response/i.test((b.getAttribute("aria-label")||"")+" "+(b.title||"")+" "+(b.getAttribute("data-testid")||"")));
  if(labeled.length)return labeled.at(-1);
  const blueTriangle=buttons.filter(b=>{
   const svg=b.querySelector("svg");if(!svg)return false;
   const paths=[...svg.querySelectorAll("path,polygon")];
   return paths.some(p=>{
    const d=(p.getAttribute("d")||"").trim(),fill=(p.getAttribute("fill")||getComputedStyle(p).fill||"").toLowerCase(),style=(p.getAttribute("style")||"").toLowerCase();
    const isBlue=fill.includes("#")||fill.includes("rgb(")||fill.includes("blue")||style.includes("#")||style.includes("rgb(";
    const triangle= p.tagName.toLowerCase()==="polygon" || (/z$/i.test(d)&&((d.match(/[ML]/gi)||[]).length<=4));
    return isBlue&&triangle;
   });
  });
  return blueTriangle.at(-1)||null;
 }
 // Track both media elements and CAI's playback button state/DOM changes.
 let audioMonitorObserver=null, audioStateSignature="";
 function playbackState(){
  const media=[...document.querySelectorAll("audio,video")];
  const mediaOn=media.some(a=>!a.paused&&!a.ended&&a.currentTime>0);
  const b=replyReadAloudButton();
  const label=((b?.getAttribute("aria-label")||"")+" "+(b?.title||"")+" "+(b?.getAttribute("data-testid")||"")).toLowerCase();
  const pressed=b?.getAttribute("aria-pressed")==="true";
  const playingLabel=/pause|stop audio|playing/.test(label);
  return mediaOn||pressed||playingLabel;
 }
 let wasGenerating=false, generationFinishedAt=0;
 function generationActive(){
  // CAI exposes a stop-generation control while the assistant is composing.
  return [...document.querySelectorAll("button,[role=button]")].some(el=>{
   const s=((el.getAttribute("aria-label")||"")+" "+(el.getAttribute("title")||"")+" "+(el.getAttribute("data-testid")||"")+" "+(el.textContent||"")).toLowerCase().trim();
   return !el.disabled && /stop generating|stop response|cancel generation|interrupt response/.test(s);
  });
 }
 function monitorVoice(){
  if(!active)return;
  const generating=generationActive(), playing=playbackState();
  if(generating){wasGenerating=true;lastRecoveryClick=Date.now();return}
  if(wasGenerating){
   wasGenerating=false;generationFinishedAt=Date.now();lastRecoveryClick=Date.now();
   const b=replyReadAloudButton();if(b){b.click();log("Generation finished; clicked the reply's blue Read Aloud triangle.")}else log("Generation finished; Read Aloud triangle not found.");
  }
  if(playing){if(!audioWasPlaying)log("Reply Read Aloud playback detected.");audioWasPlaying=true;return}
  if(audioWasPlaying){audioWasPlaying=false;lastRecoveryClick=Date.now();log("Reply audio finished; leaving Read Aloud button alone.");return}
  // The triangle starts playback; never click it repeatedly as an idle toggle.
 }
 function startAudioMonitor(){
  clearInterval(monitorTimer);monitorTimer=setInterval(monitorVoice,1000);
  if(audioMonitorObserver)audioMonitorObserver.disconnect();
  audioMonitorObserver=new MutationObserver(()=>{if(!active)return;const state=playbackState(), generating=generationActive();const sig=generating?"generating":state?"playing":"idle";if(sig!==audioStateSignature){audioStateSignature=sig;if(generating){wasGenerating=true;lastRecoveryClick=Date.now();}else if(state){audioWasPlaying=true;log("CAI audio state changed to playing.")}else if(audioWasPlaying&&!generating){audioWasPlaying=false;lastRecoveryClick=Date.now();log("Reply audio ended; no extra triangle click.")}}});
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
 function start(){if(!SR){log("SpeechRecognition unavailable. Use Chrome.");return}active=true;busy=false;submitLock=false;lastRecoveryClick=Date.now();startRecognition();startAudioMonitor();log("Continuous mic + auto Read Aloud on completed replies.")}
 function stop(){active=false;busy=false;submitLock=false;clearTimeout(restartTimer);clearInterval(monitorTimer);audioMonitorObserver?.disconnect();audioMonitorObserver=null;try{recognition?.stop()}catch{}recognition=null;audioWasPlaying=false;log("Stopped listening.")}
 chrome.runtime.onMessage.addListener((m,sender,sendResponse)=>{if(m?.action==="PING"){sendResponse({ok:true});return true}if(m?.action==="START"){start();sendResponse({ok:true});return true}if(m?.action==="STOP"){stop();sendResponse({ok:true});return true}});
})();