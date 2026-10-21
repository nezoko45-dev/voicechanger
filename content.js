(() => {
  if (window.__ttslabFastDictation) return;
  window.__ttslabFastDictation = true;
  const visible = el => !!el && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const meta = el => [el.getAttribute?.("aria-label"),el.getAttribute?.("placeholder"),el.getAttribute?.("data-placeholder"),el.getAttribute?.("name"),el.getAttribute?.("data-testid"),el.getAttribute?.("title"),el.getAttribute?.("role"),el.getAttribute?.("contenteditable")].filter(Boolean).join(" ").toLowerCase();
  const chatHints = /chat|message|conversation|ask|reply|talk to|voice agent/;
  const speechHints = /fish\\s*audio|generate speech|text to speech|tts|speech text/;
  const boxSelector = 'textarea,input:not([type]),input[type="text"],input:not([type="hidden"]),[contenteditable="true"],[role="textbox"],[data-slate-editor="true"],[data-lexical-editor="true"],[data-placeholder],[data-testid*="input" i],[class*="textarea" i],[class*="composer" i]';
  function rootsFor(doc) {
    const roots=[], seen=new Set();
    function walk(root) {
      if(!root||seen.has(root))return;seen.add(root);roots.push(root);
      let all=[];try{all=root.querySelectorAll("*");}catch{return;}
      for(const el of all){
        if(el.shadowRoot)walk(el.shadowRoot);
        if(el.tagName==="IFRAME"){try{if(el.contentDocument?.documentElement)walk(el.contentDocument);}catch{}}
      }
    }
    walk(doc);return roots;
  }
  function allMatches(selector,roots) {
    const result=[];
    for(const root of roots){try{result.push(...root.querySelectorAll(selector));}catch{}}
    return [...new Set(result)];
  }
  function findTextBox(roots) {
    const list=allMatches(boxSelector,roots).filter(el=>visible(el)&&!el.disabled&&el.getAttribute("aria-disabled")!=="true"&&el.getAttribute("type")!=="hidden");
    const score=el=>{
      const m=meta(el),rect=el.getBoundingClientRect();
      return (el.tagName==="TEXTAREA"?18:0)+(el.isContentEditable||el.getAttribute("role")==="textbox"?8:0)
        +(/text|speech|script|prompt|type here|enter text|write|say|input|fish audio/.test(m)?12:0)
        +(speechHints.test(m)?16:0)
        +(chatHints.test(m)?24:0)
        +(/chat|message|composer|prompt|input|textarea/i.test(String(el.className||""))?8:0)
        +Math.min(8,Math.round(rect.width/150))
        -(/search|filter|email|password|voice name|model search/i.test(m)?35:0);
    };
    return list.sort((a,b)=>score(b)-score(a))[0]||null;
  }
  function setText(box,text) {
    const win=box.ownerDocument.defaultView||window;
    box.focus();
    if(box.isContentEditable||box.getAttribute("contenteditable")==="true"||box.hasAttribute("data-slate-editor")||box.hasAttribute("data-lexical-editor")) {
      box.replaceChildren(box.ownerDocument.createTextNode(text));
    } else {
      const proto=box.tagName==="TEXTAREA"?win.HTMLTextAreaElement?.prototype:win.HTMLInputElement?.prototype;
      const setter=proto&&Object.getOwnPropertyDescriptor(proto,"value")?.set;
      if(setter)setter.call(box,text);else box.value=text;
    }
    const EventInput=win.InputEvent||InputEvent;
    box.dispatchEvent(new EventInput("input",{bubbles:true,composed:true,inputType:"insertText",data:text}));
    box.dispatchEvent(new win.Event("change",{bubbles:true,composed:true}));
  }
  function label(el){return [el.innerText,el.textContent,el.value,el.getAttribute("aria-label"),el.getAttribute("title"),el.getAttribute("data-testid"),el.getAttribute("data-icon")].filter(Boolean).join(" ").replace(/\s+/g," ").trim();}
  function findActionButton(box,roots) {
    const buttons=allMatches("button,[role='button'],input[type='submit'],input[type='button']",roots).filter(visible);
    const boxMeta=meta(box),chatMode=chatHints.test(boxMeta)||chatHints.test(String(box.className||""));
    const enabled=el=>!el.disabled&&el.getAttribute("aria-disabled")!=="true"&&el.getAttribute("aria-busy")!=="true";
    const sameDoc=buttons.filter(el=>el.ownerDocument===box.ownerDocument);
    const pool=sameDoc.length?sameDoc:buttons;
    if(chatMode) {
      const send=pool.filter(el=>enabled(el)&&(/^(send|send message|submit|reply|go)$/i.test(label(el))||/send message|send-button|chat-send|submit-message|send/i.test(meta(el))));
      if(send.length)return send.sort((a,b)=>label(a).length-label(b).length)[0];
      const form=box.closest?.("form");
      const submit=form?.querySelector('button[type="submit"],input[type="submit"]');
      if(visible(submit)&&enabled(submit))return submit;
    }
    return pool.filter(enabled).find(el=>/^stream$/i.test(label(el)))||
      pool.filter(enabled).filter(el=>/\bstream\b/i.test(label(el))&&!/streaming settings|stream history|stream key/i.test(label(el))).sort((a,b)=>label(a).length-label(b).length)[0]||
      pool.filter(el=>enabled(el)&&/generate\\s*speech|generate|create speech|text to speech|stream|send|submit|run/i.test(label(el))).sort((a,b)=>{const score=x=>(/generate\\s*speech/i.test(label(x))?0:/^stream$/i.test(label(x))?1:/send|submit/i.test(label(x))?2:3);return score(a)-score(b)||label(a).length-label(b).length;})[0]||null;
  }
  let busy=false,lastText="",lastAt=0;
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type!=="TT_FAST_SUBMIT"&&message?.type!=="TT_FAST_PREVIEW")return;
    const text=String(message.text||"").replace(/\s+/g," ").trim();
    if(message.type==="TT_FAST_PREVIEW"){
      if(!text){sendResponse({ok:true});return;}
      const previewRoots=rootsFor(document),previewBox=findTextBox(previewRoots);
      if(!previewBox){sendResponse({ok:false,message:"Can't find a visible TTSLab text field for live dictation."});return;}
      try{setText(previewBox,text);sendResponse({ok:true,message:"Live transcript updated."});}
      catch(error){sendResponse({ok:false,message:"Couldn't update live transcript: "+(error?.message||String(error))});}
      return;
    }
    if(!text){sendResponse({ok:false,message:"No speech was recognized."});return;}
    const now=Date.now();
    if(text.toLowerCase()===lastText.toLowerCase()&&now-lastAt<5000){sendResponse({ok:true,duplicate:true,message:"Duplicate phrase ignored."});return;}
    if(busy){sendResponse({ok:false,message:"Still submitting the previous phrase; try again after it finishes."});return;}
    const roots=rootsFor(document),box=findTextBox(roots);
    if(!box){sendResponse({ok:false,message:"I still can't find a visible text field on this TTSLab page. Refresh the TTSLab tab after reloading the extension; if it persists, send me a screenshot of the page and address bar."});return;}
    busy=true;
    try {
      setText(box,text);
      const button=findActionButton(box,roots);
      if(!button){sendResponse({ok:false,message:"I found the text field but couldn't identify Fish Audio's Generate Speech or TTSLab's Stream/Send button. If this persists, send a screenshot of the page."});return;}
      if(!enabledButton(button)){sendResponse({ok:false,message:"The Generate Speech/Stream button is unavailable right now. Wait for the page to finish, then try again."});return;}
      button.click();
      lastText=text;lastAt=Date.now();
      sendResponse({ok:true,message:/generate|speech|create/i.test(label(button))?"Transcribed into the text field and clicked Generate Speech.":/send|reply|submit|go/i.test(label(button))?"Transcribed into the text field and clicked Send.":"Transcribed into the text field and clicked Stream."});
    } catch(error) {
      sendResponse({ok:false,message:"Couldn't submit this phrase: "+(error?.message||String(error))});
    } finally {busy=false;}
  });
  function enabledButton(el){return !el.disabled&&el.getAttribute("aria-disabled")!=="true"&&el.getAttribute("aria-busy")!=="true";}
})();