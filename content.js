(() => {
 if(window.__voiceDictatorLoaded)return;window.__voiceDictatorLoaded=true;
 let active=false,rec=null,waiting=false,restart=null,answerPoll=null,playPoll=null,external=false,externalPoll=null;
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition,log=x=>console.log("[Voice Dictator] "+x);
 const composer=()=>document.querySelector("#prompt-textarea")||document.querySelector('[contenteditable="true"][data-testid="composer"]')||document.querySelector('[contenteditable="true"][role="textbox"]');
 function put(el,s){el.focus();if(el instanceof HTMLTextAreaElement)Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(el,s);else el.textContent=s;el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:s}))}
 function clickSend(){let b=document.querySelector('button[data-testid="send-button"]')||document.querySelector('button[aria-label*="Send" i]');if(b&&!b.disabled){b.click();return true}let el=composer();if(el){el.focus();el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}));el.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",code:"Enter",bubbles:true}));return true}return false}
 function listen(){if(!active||waiting||rec||external||!SR)return;clearTimeout(restart);try{let r=new SR();rec=r;r.lang="en-US";r.continuous=true;r.interimResults=true;r.maxAlternatives=1;let sent=false;r.onresult=e=>{if(!active||waiting||sent)return;let phrase="";for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)phrase+=e.results[i][0].transcript+" ";phrase=phrase.trim();if(phrase){sent=true;submit(phrase)}};r.onerror=e=>log("Recognition error: "+e.error);r.onend=()=>{if(rec===r)rec=null;if(active&&!waiting)restart=setTimeout(listen,700)};r.start();log("Mic active")}catch(e){rec=null;log("Mic start: "+e.message);restart=setTimeout(listen,1200)}}
 function submit(text){waiting=true;let old=rec;rec=null;try{old&&old.stop()}catch{}let el=composer();if(!el){log("Composer missing");waiting=false;restart=setTimeout(listen,1000);return}put(el,text);setTimeout(()=>{if(!active)return;if(!clickSend()){log("Send failed");waiting=false;restart=setTimeout(listen,1000);return}log("Sent: "+text);waitAnswer()},350)}
 const messages=()=>[...document.querySelectorAll('[data-message-author-role="assistant"]')];
 function waitAnswer(){let before=messages().length,last="",stable=0,started=false;clearInterval(answerPoll);answerPoll=setInterval(()=>{if(!active)return clearInterval(answerPoll);let arr=messages(),m=arr.at(-1),stop=document.querySelector('button[data-testid="stop-button"]')||document.querySelector('button[aria-label*="Stop generating" i]');if(arr.length>before||stop)started=true;if(!started||!m)return;let t=m.innerText.trim();if(!t||stop){stable=0;return}stable=t===last?stable+1:0;last=t;if(stable>=4){clearInterval(answerPoll);startRead(m)}},700);setTimeout(()=>{if(active&&!started){clearInterval(answerPoll);log("Response timeout; restarting mic");waiting=false;restart=setTimeout(listen,1000)}},45000)}
 function startRead(m){
  if(!active)return;
  const turn=m.closest('[data-testid^="conversation-turn"]')||m.closest("article")||m.parentElement?.parentElement||m;
  // Hover the response to expose its toolbar, including icon-only controls.
  for(const target of [m,turn])for(const type of ["mouseenter","mouseover","mousemove"])
   target.dispatchEvent(new MouseEvent(type,{bubbles:true,view:window}));
  const score=x=>{
   const svg=x.querySelector("svg");
   const label=[x.getAttribute("aria-label"),x.getAttribute("title"),x.getAttribute("data-testid"),x.getAttribute("data-tooltip"),x.innerText,svg?.getAttribute("aria-label"),svg?.getAttribute("data-testid"),svg?.getAttribute("title")].filter(Boolean).join(" ").toLowerCase();
   if(/read.?aloud|audio.?play|voice.?play|play.?audio|tts/.test(label))return 100;
   if(/copy|share|edit|regenerate|thumb|report|more|menu|stop|pause/.test(label))return -1;
   const markup=(svg?.outerHTML||"").toLowerCase();
   if(/speaker|volume|audio|sound|headphones/.test(markup))return 30;
   return 0;
  };
  const find=()=>{
   const scopes=[turn,document],buttons=[...new Set(scopes.flatMap(s=>[...s.querySelectorAll('button,[role="button"]')]))];
   return buttons.map(b=>({b,s:score(b)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s)[0]?.b||null;
  };
  setTimeout(()=>{if(!active)return;const b=find();if(!b){log("Read aloud control not found. Buttons: "+[...turn.querySelectorAll("button")].map(x=>x.getAttribute("aria-label")||x.title||x.dataset.testid||x.innerText||"icon").join(" | "));waiting=false;restart=setTimeout(listen,900);return}
   b.click();log("Clicked Read aloud (button/SVG control)");monitorPlayback()},650)
 }
 function monitorPlayback(){let quiet=0;clearInterval(playPoll);playPoll=setInterval(()=>{if(!active)return clearInterval(playPoll);let audio=[...document.querySelectorAll("audio")].some(a=>!a.paused&&!a.ended),reading=[...document.querySelectorAll("button,[role=button]")].some(b=>/pause reading|stop reading|stop playback/i.test((b.getAttribute("aria-label")||"")+" "+(b.title||"")));if(audio||reading){quiet=0;return}if(++quiet>=8){clearInterval(playPoll);waiting=false;log("Playback done; mic resumes");restart=setTimeout(listen,700)}},1000)}
 async function startExternal(){
  try{
   const r=await fetch("http://127.0.0.1:8765/health",{cache:"no-store"});
   if(!r.ok)throw Error("bridge unavailable");
   external=true;log("Using Windows Dictation EXE");
   externalPoll=setInterval(async()=>{
    if(!active||waiting)return;
    try{const q=await fetch("http://127.0.0.1:8765/next",{cache:"no-store"});const j=await q.json();if(j.text&&j.text.trim())submit(j.text.trim())}catch(e){log("EXE bridge disconnected")}
   },450);
  }catch(e){external=false;if(SR)listen();else log("Start ChatGPTDictation.exe first (or enable Chrome SpeechRecognition)")}
 }
 chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m.action==="START"){active=true;waiting=false;startExternal();reply({status:"Started"});}else if(m.action==="STOP"){active=false;waiting=false;external=false;clearTimeout(restart);clearInterval(answerPoll);clearInterval(playPoll);clearInterval(externalPoll);try{rec&&rec.stop()}catch{}rec=null;log("Stopped");reply({status:"Stopped"})}return true});
})();