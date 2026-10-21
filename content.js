(() => {
  if (window.__ttslabFastDictation) return;
  window.__ttslabFastDictation = true;
  const visible = el => !!el && el.getClientRects().length > 0;
  const meta = el => [el.getAttribute("aria-label"),el.getAttribute("placeholder"),el.getAttribute("data-placeholder"),el.getAttribute("name"),el.getAttribute("data-testid"),el.getAttribute("title")].filter(Boolean).join(" ").toLowerCase();
  function findTextBox() {
    const list=[...document.querySelectorAll('textarea,input:not([type]),input[type="text"],[contenteditable="true"],[role="textbox"],[data-slate-editor="true"],[data-lexical-editor="true"]')].filter(el=>visible(el)&&!el.disabled&&el.getAttribute("aria-disabled")!=="true");
    const score=el=>{const m=meta(el);return (el.tagName==="TEXTAREA"?8:0)+(el.isContentEditable||el.getAttribute("role")==="textbox"?4:0)+(/text|speech|script|prompt|type here|enter text|write|say|input/.test(m)?10:0)-(/search|filter|email|password|voice name/.test(m)?20:0);};
    return list.sort((a,b)=>score(b)-score(a))[0]||null;
  }
  function setText(box,text) {
    box.focus();
    if(box.isContentEditable||box.getAttribute("contenteditable")==="true"||box.hasAttribute("data-slate-editor")||box.hasAttribute("data-lexical-editor")) box.replaceChildren(document.createTextNode(text));
    else {const proto=box.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;if(setter)setter.call(box,text);else box.value=text;}
    box.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));
    box.dispatchEvent(new Event("change",{bubbles:true}));
  }
  function label(el){return [el.innerText,el.textContent,el.value,el.getAttribute("aria-label"),el.title].filter(Boolean).join(" ").replace(/\s+/g," ").trim();}
  function findStreamButton(){const buttons=[...document.querySelectorAll("button,[role='button'],input[type='submit'],input[type='button']")].filter(visible);return buttons.find(el=>/^stream$/i.test(label(el)))||buttons.filter(el=>/\bstream\b/i.test(label(el))&&!/streaming settings|stream history|stream key/i.test(label(el))).sort((a,b)=>label(a).length-label(b).length)[0]||null;}
  let busy=false,lastText="",lastAt=0;
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type!=="TT_FAST_SUBMIT")return;
    const text=String(message.text||"").replace(/\s+/g," ").trim();
    if(!text){sendResponse({ok:false,message:"No speech was recognized."});return;}
    const now=Date.now();
    if(text.toLowerCase()===lastText.toLowerCase()&&now-lastAt<5000){sendResponse({ok:true,duplicate:true,message:"Duplicate phrase ignored."});return;}
    if(busy){sendResponse({ok:false,message:"Still submitting the previous phrase; try the next phrase after it finishes."});return;}
    const box=findTextBox();
    if(!box){sendResponse({ok:false,message:"Can't find a visible TTSLab text box. Open the tool/model page with the text field and Stream button."});return;}
    const button=findStreamButton();
    if(!button){sendResponse({ok:false,message:"Text box found, but no Stream button is visible on this TTSLab page."});return;}
    if(button.disabled||button.getAttribute("aria-disabled")==="true"||button.getAttribute("aria-busy")==="true"){sendResponse({ok:false,message:"Stream is currently unavailable. Wait for TTSLab to finish, then speak the next phrase."});return;}
    busy=true;
    try{setText(box,text);button.click();lastText=text;lastAt=Date.now();sendResponse({ok:true,message:"Submitted and clicked Stream."});}
    catch(error){sendResponse({ok:false,message:"Couldn't submit this phrase: "+(error?.message||String(error))});}
    finally{busy=false;}
  });
})();
