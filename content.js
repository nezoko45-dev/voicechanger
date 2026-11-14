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
 
 // Character.AI: keep its voice control alive without interrupting generation.
 let caiMode=false,caiKeep=null,caiBusy=false,caiLastSpeech=0,caiPoll=null,caiToggleBusy=false;
 const isCAI=()=>location.hostname==="character.ai"||location.hostname.endsWith(".character.ai");
 function caiVoiceButton(){
  const all=[...document.querySelectorAll("button,[role=button]")];
  const ranked=all.map(b=>{
   const s=[b.getAttribute("aria-label"),b.getAttribute("title"),b.getAttribute("data-testid"),b.innerText,b.querySelector("svg")?.outerHTML].filter(Boolean).join(" ").toLowerCase();
   let score=0;
   if(/voice|call/.test(s))score+=8;
   if(/start|end|turn on|turn off|enable|disable/.test(s))score+=3;
   if(/microphone|mic/.test(s))score+=2;
   if(/send|message|record|listen|mute|speaker|audio output/.test(s))score-=8;
   if(b.querySelector("svg"))score+=1;
   return {b,score,s};
  }).filter(x=>x.score>=8).sort((a,b)=>b.score-a.score);
  return ranked[0]?.b||null;
 }
 function caiVoiceOn(b){
  const s=[b?.getAttribute("aria-label"),b?.getAttribute("title"),b?.innerText,b?.dataset.testid].filter(Boolean).join(" ").toLowerCase();
  if(/end voice|end call|stop voice|turn off voice|disable voice/.test(s))return true;
  if(/start voice|start call|turn on voice|enable voice/.test(s))return false;
  return null;
 }
 async function caiToggle(){
  if(!active||!caiMode||caiBusy||caiToggleBusy)return;
  const b=caiVoiceButton();if(!b){log("Character.AI voice toggle not found; keepalive skipped");return}
  caiToggleBusy=true;
  try{
   const on=caiVoiceOn(b);
   // Pulse only when it is currently active; never accidentally start a call from off.
   if(on===false){log("Character.AI voice is off; leaving it off");return}
   b.click();log("Character.AI voice refresh: OFF");
   setTimeout(()=>{if(active&&caiMode&&!caiBusy){const fresh=caiVoiceButton();if(fresh&&caiVoiceOn(fresh)!==true)fresh.click();log("Character.AI voice refresh: ON")}caiToggleBusy=false},450);
  }catch(e){caiToggleBusy=false;log("c.ai voice refresh error: "+e.message)}
 }
 function caiSchedule(){clearTimeout(caiKeep);if(active&&caiMode&&!caiBusy)caiKeep=setTimeout(caiToggle,5000)}
 function caiGeneration(){
  return !!document.querySelector('button[aria-label*="Stop generating" i],button[data-testid*="stop" i]')||
   [...document.querySelectorAll("button")].some(b=>/stop generating|cancel generation/i.test((b.getAttribute("aria-label")||"")+" "+b.innerText));
 }
 function caiWaitGeneration(){
  caiBusy=true;clearTimeout(caiKeep);let seen=caiGeneration(),stable=0;
  clearInterval(caiPoll);caiPoll=setInterval(()=>{if(!active||!caiMode){clearInterval(caiPoll);return}
   const g=caiGeneration();if(g){seen=true;stable=0;return}
   if(seen){if(++stable>=3){clearInterval(caiPoll);caiBusy=false;log("Character.AI generation finished; keepalive resumed");caiSchedule()}}
   else if(Date.now()-caiLastSpeech>15000){clearInterval(caiPoll);caiBusy=false;caiSchedule()}
  },700);
 }
 function caiSubmit(text){
  caiBusy=true;clearTimeout(caiKeep);caiLastSpeech=Date.now();
  const el=document.querySelector('textarea')||document.querySelector('[contenteditable="true"]')||document.querySelector('[role="textbox"]');
  if(!el){log("Character.AI chat input not found");caiBusy=false;caiSchedule();return}
  put(el,text);
  setTimeout(()=>{
   const send=[...document.querySelectorAll("button")].find(b=>/send|submit/i.test((b.getAttribute("aria-label")||"")+" "+(b.title||""))&&!b.disabled);
   if(send)send.click();else{el.focus();el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}));el.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",code:"Enter",bubbles:true}))}
   log("Character.AI sent dictation: "+text);caiWaitGeneration();
  },250);
 }
 function caiListen(){
  if(!active||!caiMode||waiting||rec||!SR)return;clearTimeout(restart);
  try{const r=new SR();rec=r;r.lang="en-US";r.continuous=true;r.interimResults=true;r.maxAlternatives=1;let sent=false;
   r.onresult=e=>{if(!active||sent)return;let phrase="";for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)phrase+=e.results[i][0].transcript+" ";phrase=phrase.trim();if(phrase){sent=true;caiSubmit(phrase)}};
   r.onerror=e=>log("c.ai speech recognition: "+e.error);r.onend=()=>{if(rec===r)rec=null;if(active&&caiMode&&!caiBusy)restart=setTimeout(caiListen,650)};
   r.start();log("Character.AI Chrome mic listening");caiSchedule();
  }catch(e){rec=null;restart=setTimeout(caiListen,1000);log("c.ai mic: "+e.message)}
 }
 function startCAI(){caiMode=true;active=true;caiBusy=false;caiLastSpeech=Date.now();clearTimeout(caiKeep);caiListen();log("Character.AI mode started (5s idle voice pulse)")}
 
 chrome.runtime.onMessage.addListener((m,s,reply)=>{if(m.action==="START_CAI"){startCAI();reply({status:"Character.AI started"});}else if(m.action==="START"){caiMode=false;active=true;waiting=false;startExternal();reply({status:"Started"});}else if(m.action==="STOP"){active=false;waiting=false;external=false;caiMode=false;caiBusy=false;clearTimeout(caiKeep);clearInterval(caiPoll);clearTimeout(restart);clearInterval(answerPoll);clearInterval(playPoll);clearInterval(externalPoll);try{rec&&rec.stop()}catch{}rec=null;log("Stopped");reply({status:"Stopped"})}return true});
})();