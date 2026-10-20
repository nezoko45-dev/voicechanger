(() => {
 if(window.__inworldDictationInstalled)return;window.__inworldDictationInstalled=true;
 const visible=el=>!!el&&el.getClientRects().length>0;
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 let generating=false;
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
 function labels(el){return[el.getAttribute("aria-label"),el.title,el.innerText,el.textContent,el.value,el.getAttribute("data-testid")].filter(Boolean).map(s=>s.trim());}
 function findGenerate(box){
  const buttons=[...document.querySelectorAll("button,[role='button'],input[type='submit']")].filter(visible);
  const matches=buttons.filter(b=>labels(b).some(label=>/^(generate|generate speech|synthesize|create speech|generate audio)$/i.test(label)||/generate|synthesize|create speech/.test(label.toLowerCase())));
  if(!matches.length)return null;
  let node=box;for(let depth=0;node&&depth<12;depth++,node=node.parentElement){const nearby=matches.find(b=>node.contains(b));if(nearby)return nearby;}
  return matches.find(b=>/generate|synthesize|create speech/i.test(labels(b).join(" ")))||null;
 }
 const busy=b=>!b||b.disabled||b.getAttribute("aria-disabled")==="true"||b.getAttribute("aria-busy")==="true"||/generating|processing|loading|synthesizing/.test(labels(b).join(" ").toLowerCase());
 function diagnose(){
  const box=findTextBox(),button=box&&findGenerate(box);
  if(!box)return "The extension can reach this Inworld tab, but can't identify the text-entry box. This is a page-layout/selector issue, not proof that you're signed out. Make sure you're on https://platform.inworld.ai/tts-playground and the playground has finished loading.";
  if(!button)return "The extension found a text box but couldn't find the page's Generate button. This is a page-layout/selector issue, not a sign-in check. Confirm you're on the Inworld TTS Playground.";
  if(busy(button))return "The Generate button is currently disabled. Select a voice/model and make sure the page is ready; signing in again may not help.";
  return "The Inworld page isn't ready yet.";
 }
 async function waitReady(timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const box=findTextBox(),button=box&&findGenerate(box);if(box&&button&&!busy(button))return{box,button};await sleep(500);}throw new Error(diagnose());}
 async function preview(text){if(generating)return;const {box}=await waitReady(10000);if(generating)return;setText(box,text);}
 async function generate(text){
  const phrase=String(text||"").trim();if(!phrase)throw new Error("No transcript received.");
  if(generating)throw new Error("Inworld is already generating speech. Please wait for the current generation to finish.");
  generating=true;
  try{
   let{box,button}=await waitReady();setText(box,phrase);await sleep(250);({box,button}=await waitReady(10000));
   button.click();
   const deadline=Date.now()+120000;let sawBusy=false;
   while(Date.now()<deadline){const currentBox=box.isConnected?box:findTextBox(),currentButton=currentBox?findGenerate(currentBox):null;
    if(currentButton&&busy(currentButton))sawBusy=true;
    if(sawBusy&&currentButton&&!busy(currentButton))return{ok:true,message:"Inworld Generate finished. Dictation is still listening."};
    if(!sawBusy&&Date.now()>deadline-117000){await sleep(2500);return{ok:true,message:"Clicked Inworld Generate. Check the page for the generated audio."};}
    await sleep(400);
   }
   return{ok:true,message:"Clicked Inworld Generate. It may still be processing; check the Inworld page."};
  }finally{generating=false;}
 }
 chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="IVD_PREVIEW"&&typeof message.text==="string"){preview(message.text).then(()=>sendResponse({ok:true,message:"Transcript filled into Inworld."})).catch(error=>sendResponse({ok:false,message:error?.message||String(error)}));return true;}
  if(message?.type==="IVD_GENERATE"&&typeof message.text==="string"){generate(message.text).then(sendResponse).catch(error=>sendResponse({ok:false,message:error?.message||String(error)}));return true;}
 });
})();