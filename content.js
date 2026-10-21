(() => {
  if (window.__ttslabFastDictation) return;
  window.__ttslabFastDictation = true;
  const visible = el => !!el && el.getClientRects().length > 0;
  const meta = el => [el.getAttribute("aria-label"),el.getAttribute("placeholder"),el.getAttribute("data-placeholder"),el.getAttribute("name"),el.getAttribute("data-testid"),el.getAttribute("title"),el.getAttribute("role")].filter(Boolean).join(" ").toLowerCase();
  const chatHints = /chat|message|conversation|ask|reply|talk to|voice agent/;
  function findTextBox() {
    const list=[...document.querySelectorAll('textarea,input:not([type]),input[type="text"],[contenteditable="true"],[role="textbox"],[data-slate-editor="true"],[data-lexical-editor="true"]')].filter(el=>visible(el)&&!el.disabled&&el.getAttribute("aria-disabled")!=="true");
    const score=el=>{const m=meta(el);return (el.tagName==="TEXTAREA"?8:0)+(el.isContentEditable||el.getAttribute("role")==="textbox"?4:0)+(/text|speech|script|prompt|type here|enter text|write|say|input/.test(m)?8:0)+(chatHints.test(m)?30:0)-(/search|filter|email|password|voice name/.test(m)?25:0);};
    return list.sort((a,b)=>score(b)-score(a))[0]||null;
  }
  function setText(box,text) {
    box.focus();
    if(box.isContentEditable||box.getAttribute("contenteditable")==="true"||box.hasAttribute("data-slate-editor")||box.hasAttribute("data-lexical-editor")) {
      box.replaceChildren(document.createTextNode(text));
    } else {
      const proto=box.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
      if(setter)setter.call(box,text);else box.value=text;
    }
    box.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));
    box.dispatchEvent(new Event("change",{bubbles:true}));
  }
  function label(el){return [el.innerText,el.textContent,el.value,el.getAttribute("aria-label"),el.getAttribute("title"),el.getAttribute("data-testid")].filter(Boolean).join(" ").replace(/\s+/g," ").trim();}
  function findActionButton(box) {
    const buttons=[...document.querySelectorAll("button,[role='button'],input[type='submit'],input[type='button']")].filter(visible);
    const boxMeta=meta(box);
    const chatMode=chatHints.test(boxMeta);
    const enabled=el=>!el.disabled&&el.getAttribute("aria-disabled")!=="true"&&el.getAttribute("aria-busy")!=="true";
    if(chatMode) {
      const send=buttons.filter(el=>enabled(el)&&(/^(send|send message|submit|reply)$/i.test(label(el))||/send message|send-button|chat-send|submit-message/i.test(meta(el))));
      if(send.length)return send.sort((a,b)=>label(a).length-label(b).length)[0];
      const form=box.closest("form");
      const submit=form?.querySelector('button[type="submit"],input[type="submit"]');
      if(visible(submit)&&enabled(submit))return submit;
    }
    return buttons.filter(enabled).find(el=>/^stream$/i.test(label(el)))||
      buttons.filter(enabled).filter(el=>/\bstream\b/i.test(label(el))&&!/streaming settings|stream history|stream key/i.test(label(el))).sort((a,b)=>label(a).length-label(b).length)[0]||
      (!chatMode?buttons.filter(el=>enabled(el)&&/generate speech/i.test(label(el))).sort((a,b)=>label(a).length-label(b).length)[0]:null);
  }
  let busy=false,lastText="",lastAt=0;
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type!=="TT_FAST_SUBMIT")return;
    const text=String(message.text||"").replace(/\s+/g," ").trim();
    if(!text){sendResponse({ok:false,message:"No speech was recognized."});return;}
    const now=Date.now();
    if(text.toLowerCase()===lastText.toLowerCase()&&now-lastAt<5000){sendResponse({ok:true,duplicate:true,message:"Duplicate phrase ignored."});return;}
    if(busy){sendResponse({ok:false,message:"Still submitting the previous phrase; try again after it finishes."});return;}
    const box=findTextBox();
    if(!box){sendResponse({ok:false,message:"Can't find the TTSLab chatbox or text field. Open the chat or model page and try again."});return;}
    const button=findActionButton(box);
    if(!button){sendResponse({ok:false,message:"Transcript entered, but I couldn't find a Send or Stream button to click."});return;}
    if(button.disabled||button.getAttribute("aria-disabled")==="true"||button.getAttribute("aria-busy")==="true"){sendResponse({ok:false,message:"The Send/Stream button is unavailable right now. Wait for TTSLab to finish, then try again."});return;}
    busy=true;
    try {
      setText(box,text);
      button.click();
      lastText=text;lastAt=Date.now();
      sendResponse({ok:true,message:/send|reply|submit/i.test(label(button))?"Transcribed into the TTSLab chatbox and clicked Send.":"Transcribed into the TTSLab text field and clicked Stream."});
    } catch(error) {
      sendResponse({ok:false,message:"Couldn't submit this phrase: "+(error?.message||String(error))});
    } finally {busy=false;}
  });
})();