(() => {
 if(window.__zaltDictationInstalled)return;window.__zaltDictationInstalled=true;
 const visible=el=>!!el&&el.getClientRects().length>0;
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 let generating=false, generationQueue=Promise.resolve(), lastSubmittedText="", lastSubmittedAt=0;
 function attrs(el){return[el.getAttribute("aria-label"),el.getAttribute("placeholder"),el.getAttribute("data-placeholder"),el.getAttribute("name"),el.getAttribute("data-testid"),el.getAttribute("title")].filter(Boolean).join(" ").toLowerCase();}
 function findTextBox(){
  const candidates=[...document.querySelectorAll('textarea,input:not([type]),input[type="text"],[contenteditable="true"],[role="textbox"],[data-slate-editor="true"],[data-lexical-editor="true"]')].filter(el=>!el.disabled&&el.getAttribute("aria-disabled")!=="true"&&visible(el));
  const score=el=>{const a=attrs(el);let n=0;if(el.tagName==="TEXTAREA")n+=8;if(el.isContentEditable||el.getAttribute("role")==="textbox"||el.hasAttribute("data-slate-editor")||el.hasAttribute("data-lexical-editor"))n+=4;if(/text|speech|script|prompt|type here|enter text|write|say/.test(a))n+=10;if(/search|filter|email|password|voice name/.test(a))n-=15;return n;};
  return candidates.sort((a,b)=>score(b)-score(a))[0]||null;
 }
 function setText(box,text){
  box.focus();
  if(box.isContentEditable||box.getAttribute("contenteditable")==="true"||box.hasAttribute("data-slate-editor")||box.hasAttribute("data-lexical-editor")){box.replaceChildren(document.createTextNode(text));box.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));box.dispatchEvent(new Event("change",{bubbles:true}));return;}
  const proto=box.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;if(setter)setter.call(box,text);else box.value=text;
  box.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));box.dispatchEvent(new Event("change",{bubbles:true}));
 }
 function labels(el){return[el.getAttribute("aria-label"),el.title,el.innerText,el.textContent,el.value,el.getAttribute("data-testid"),el.getAttribute("data-action"),typeof el.className==="string"?el.className:"",el.id].filter(Boolean).map(s=>String(s).trim()).filter(Boolean);}
 function findGenerate(box){
  const selectors="button,[role='button'],input[type='submit'],input[type='button']";
  const clickable=[...document.querySelectorAll(selectors)].filter(visible);
  const textOf=el=>[el.innerText,el.textContent,el.value,el.getAttribute("aria-label"),el.title].filter(Boolean).join(" ").replace(/\s+/g," ").trim();
  // Prefer the actual actionable button with an exact Generate Speech label.
  const exact=clickable.find(el=>/^generate\s+speech$/i.test(textOf(el)));
  if(exact)return exact;
  const matches=clickable.filter(el=>/generate\s+speech/i.test(textOf(el))&&!/download|play|preview/i.test(textOf(el)));
  if(matches.length)return matches.sort((a,b)=>textOf(a).length-textOf(b).length)[0];
  // Fallback for minor label changes, but never click a generic ancestor container.
  const fallback=clickable.filter(el=>/generate|synthesi[sz]e|create\s+speech/i.test(textOf(el))&&!/download|play|preview|background|music/i.test(textOf(el)));
  return fallback.sort((a,b)=>textOf(a).length-textOf(b).length)[0]||null;
 }
 const busy=b=>!b||b.disabled||b.getAttribute("aria-disabled")==="true"||b.getAttribute("aria-busy")==="true"||/generating|processing|loading|synthesizing|converting/.test(labels(b).join(" ").toLowerCase());
 function diagnose(){
  const box=findTextBox(),button=box&&findGenerate(box);
  if(!box)return "The extension reached Zalt Text to Speech but could not identify its text-entry box. Make sure https://zalt.me/tools/text-to-speech is open and fully loaded.";
  if(!button)return "Could not find the Generate Speech button. Wait for Zalt to finish loading.";
  return "Zalt Text to Speech isn't ready to generate speech yet.";
 }
 async function waitReady(timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const box=findTextBox(),button=box&&findGenerate(box);if(box&&button&&!busy(button))return{box,button};await sleep(500);}throw new Error(diagnose());}
 async function preview(text){if(generating)return;const {box}=await waitReady(10000);if(generating)return;setText(box,text);}
 function mediaSource(el){return el.currentSrc||el.src||el.querySelector?.("source")?.src||"";}
 async function playGeneratedAudio(previousSources){
  const deadline=Date.now()+120000;let candidate=null;
  while(Date.now()<deadline){
   const media=[...document.querySelectorAll("audio,video")];
   if(media.some(el=>!el.paused&&!el.ended&&mediaSource(el)))return "Generated audio is already playing through Chrome.";
   candidate=media.find(el=>{const src=mediaSource(el);return src&&(!previousSources.has(el)||previousSources.get(el)!==src)&&el.readyState>=2;});
   if(candidate)break;
   await sleep(300);
  }
  if(!candidate)return "Speech generated, but no new playable audio element was detected. Check whether Zalt displayed the audio player.";
  try{await candidate.play();return "Generated audio playback started through Chrome.";}
  catch(error){return "Speech generated, but Chrome blocked automatic playback. Click Play once in Zalt; after that, playback may be allowed automatically. "+(error?.message||"");}
 }
 async function generateOne(phrase){
  if(!phrase)throw new Error("No transcript received.");
  generating=true;
  try{
   let{box,button}=await waitReady(240000);
   setText(box,phrase);
   await sleep(250);
   ({box,button}=await waitReady(10000));
   const liveBox=findTextBox(),liveButton=liveBox&&findGenerate(liveBox);
   if(!liveButton||!liveButton.isConnected||busy(liveButton))throw new Error(diagnose());
   const previousSources=new Map([...document.querySelectorAll("audio,video")].map(el=>[el,mediaSource(el)]));
   // Trigger generation exactly once. Playback is handled via the media element, not by clicking a player button.
   liveButton.click();
   const playbackMessage=await playGeneratedAudio(previousSources);
   return{ok:true,message:playbackMessage+" Dictation is still listening."};
  }finally{generating=false;}
 }
 function generate(text){
  const phrase=String(text||"").trim();if(!phrase)return Promise.reject(new Error("No transcript received."));
  const now=Date.now();
  if(phrase===lastSubmittedText&&now-lastSubmittedAt<10000)return Promise.resolve({ok:true,message:"Duplicate transcript ignored; this sentence was already submitted."});
  lastSubmittedText=phrase;lastSubmittedAt=now;
  const task=generationQueue.then(()=>generateOne(phrase));
  generationQueue=task.catch(()=>{});
  return task;
 }
 chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="IVD_PREVIEW"&&typeof message.text==="string"){preview(message.text).then(()=>sendResponse({ok:true,message:"Transcript filled into Zalt Text to Speech."})).catch(error=>sendResponse({ok:false,message:error?.message||String(error)}));return true;}
  if(message?.type==="IVD_GENERATE"&&typeof message.text==="string"){generate(message.text).then(sendResponse).catch(error=>sendResponse({ok:false,message:error?.message||String(error)}));return true;}
 });
})();