(() => {
  if (window.__pocketWebDictationInstalled) return;
  window.__pocketWebDictationInstalled = true;
  function showStatus(message) {
    let node = document.getElementById("pocketweb-dictation-status");
    if (!node) {
      node = document.createElement("div"); node.id = "pocketweb-dictation-status";
      Object.assign(node.style, { position:"fixed",right:"16px",bottom:"16px",zIndex:"2147483647",background:"#111827",color:"#fff",padding:"10px 14px",borderRadius:"10px",font:"13px system-ui,sans-serif",maxWidth:"340px",boxShadow:"0 4px 20px #0004" });
      document.documentElement.appendChild(node);
    }
    node.textContent = "VoiceChanger: " + message;
  }
  function findTextBox() {
    const candidates = [...document.querySelectorAll("textarea,input:not([type]),input[type=text],[contenteditable=true],[role=textbox]")];
    return candidates.find(el => { const r=el.getBoundingClientRect(); return r.width>0 && r.height>0 && !el.disabled && !el.readOnly; });
  }
  function setText(el,text) {
    el.focus();
    if(el.isContentEditable || el.getAttribute("contenteditable")==="true") el.textContent=text;
    else {
      const proto=el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
      if(setter) setter.call(el,text); else el.value=text;
    }
    el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));
    el.dispatchEvent(new Event("change",{bubbles:true}));
  }
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.action!=="FILL_TTS_FIELD") return;
    const text=String(message.text||"").trim(), box=findTextBox();
    if(!text){sendResponse({ok:false,message:"Transcript was empty."});return;}
    if(!box){sendResponse({ok:false,message:"Could not find PocketWebTools' TTS text field. Make sure the Voice Cloning page is loaded."});return;}
    setText(box,text); showStatus("Transcript inserted into the TTS text field.");
    sendResponse({ok:true,message:"Transcript inserted into PocketWebTools' TTS text field."});
  });
})();