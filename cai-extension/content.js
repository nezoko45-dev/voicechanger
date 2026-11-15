(()=>{
 if(window.__caiAutomationLoaded)return;window.__caiAutomationLoaded=true;
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 let active=false,recognition=null,busy=false,restartTimer=null,watchTimer=null,logTimer=null;
 const log=(s)=>{console.log("[CAI Voice Automation]",s);chrome.runtime.sendMessage({type:"STATUS",text:s}).catch(()=>{})};
 const input=()=>document.querySelector('textarea[placeholder],textarea')||document.querySelector('[contenteditable="true"][role="textbox"]')||document.querySelector('[contenteditable="true"]');
 function setText(el,text){
  el.focus();
  if(el instanceof HTMLTextAreaElement){const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;setter.call(el,text)}
  else{el.textContent=text}
  el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));
 }
 function sendMessage(){
  const el=input();if(!el)return false;
  const b=[...document.querySelectorAll("button")].find(x=>/send/i.test((x.getAttribute("aria-label")||"")+" "+(x.title||""))&&!x.disabled);
  if(b){b.click();return true}
  el.focus();el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}));el.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",code:"Enter",bubbles:true}));return true;
 }
 function startRecognition(){
  if(!active||busy||recognition||!SR)return;
  clearTimeout(restartTimer);
  try{
   const r=new SR();recognition=r;r.lang="en-US";r.continuous=true;r.interimResults=false;r.maxAlternatives=1;
   r.onstart=()=>log("Microphone active — speak now.");
   r.onerror=e=>log("Speech error: "+e.error);
   r.onresult=e=>{let text="";for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)text+=e.results[i][0].transcript+" ";text=text.trim();if(text&&!busy){log("Heard: "+text);submit(text)}};
   r.onend=()=>{if(recognition===r)recognition=null;if(active&&!busy)restartTimer=setTimeout(startRecognition,800)};
   r.start();
  }catch(e){recognition=null;log("Start failed: "+e.message);restartTimer=setTimeout(startRecognition,1500)}
 }
 function submit(text){
  busy=true;const r=recognition;recognition=null;try{r?.stop()}catch{}
  const el=input();if(!el){busy=false;log("Chat textbox not found.");restartTimer=setTimeout(startRecognition,1000);return}
  setText(el,text);
  setTimeout(()=>{if(!active)return;if(!sendMessage()){busy=false;log("Send control not found.");restartTimer=setTimeout(startRecognition,1000);return}log("Sent dictated message.");waitForReply()},300);
 }
 function voiceButton(){
  const candidates=[...document.querySelectorAll("button,[role=button]")];
  return candidates.find(b=>{const s=(b.getAttribute("aria-label")||"")+" "+(b.title||"")+" "+(b.innerText||"");return /voice|audio|speak|listen/i.test(s)})||
   candidates.find(b=>/svg/i.test(b.innerHTML)&&/mic|wave|sound|audio|voice/i.test(b.innerHTML));
 }
 function toggleVoice(){const b=voiceButton();if(b){b.click();log("Clicked voice control.");return true}log("Voice button not found (inspect CAI button labels).");return false}
 function waitForReply(){
  let last="",same=0,seen=false,limit=0;clearInterval(watchTimer);
  watchTimer=setInterval(()=>{
   if(!active){clearInterval(watchTimer);return}
   const audios=[...document.querySelectorAll("audio")],playing=audios.some(a=>!a.paused&&!a.ended);
   const stop=[...document.querySelectorAll("button")].some(b=>/stop generating/i.test((b.getAttribute("aria-label")||"")+" "+b.title));
   const msgs=[...document.querySelectorAll('[class*="message"],[data-message-id]')];const tail=msgs.at(-1)?.innerText||"";
   if(playing){seen=true;same=0}
   if(stop){seen=true;same=0}
   if(tail&&tail!==last){last=tail;seen=true;same=0}else if(seen&&!playing&&!stop)same++;
   if(++limit>100){clearInterval(watchTimer);busy=false;startRecognition();log("Reply monitor timed out; listening again.");return}
   if(seen&&!playing&&!stop&&same>=5){clearInterval(watchTimer);log("Reply settled. Listening again.");busy=false;startRecognition()}
  },1000);
 }
 function start(){if(!SR){log("SpeechRecognition unavailable in this Chrome.");return}active=true;busy=false;startRecognition();log("Automation enabled.")}
 function stop(){active=false;busy=false;clearTimeout(restartTimer);clearInterval(watchTimer);try{recognition?.stop()}catch{}recognition=null;log("Stopped.")}
 chrome.runtime.onMessage.addListener(m=>{if(m.action==="START")start();if(m.action==="STOP")stop()});
})();