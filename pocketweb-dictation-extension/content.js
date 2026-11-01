(() => {
  if (window.__pocketWebDictationInstalled) return;
  window.__pocketWebDictationInstalled = true;
  let recognition=null, running=false, busy=false, localMode=false, localChecked=false;
  let finalText="", silenceTimer=0, restartTimer=0, retryCount=0;
  const SILENCE_MS=2500;
  const status=(message)=>{window.__pocketWebDictationStatus=message;};
  const visible=(el)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=="hidden";};
  function describe(el){return [el.placeholder,el.getAttribute("aria-label"),el.name,el.id,el.getAttribute("data-testid"),el.closest("label")?.innerText,el.parentElement?.innerText].filter(Boolean).join(" ").toLowerCase();}
  function findTextBox(){
    const els=[...document.querySelectorAll("textarea,input:not([type]),input[type=text],[contenteditable=true],[role=textbox]")].filter(el=>visible(el)&&!el.disabled&&!el.readOnly);
    const score=el=>{const d=describe(el);let n=el.tagName==="TEXTAREA"?100:0;if(el.isContentEditable)n+=70;if(/text to speak|speech text|enter text|type text|script|content/.test(d))n+=80;if(/reference|voice name|search|url|file|email|password/.test(d))n-=100;if(el.maxLength>500||el.rows>1)n+=15;return n;};
    return els.sort((a,b)=>score(b)-score(a))[0]||null;
  }
  function findGenerate(){
    return [...document.querySelectorAll("button,[role=button],input[type=button],input[type=submit]")].filter(visible).find(el=>{
      const t=(el.innerText||el.textContent||el.value||el.getAttribute("aria-label")||"").trim().toLowerCase();
      return t.includes("generate speech")||t==="generate"||t.includes("generate audio");
    })||null;
  }
  function findResultButton(){
    return [...document.querySelectorAll("button,[role=button],input[type=button],input[type=submit],a")].filter(visible).find(el=>{
      const t=(el.innerText||el.textContent||el.value||el.getAttribute("aria-label")||"").trim().toLowerCase();
      return /^(view\\s+)?result(s)?$/.test(t)||t==="show result"||t==="see result";
    })||null;
  }
  async function waitForResultAndClick(){
    const deadline=Date.now()+90000;
    while(running&&Date.now()<deadline){
      await new Promise(r=>setTimeout(r,500));
      const result=findResultButton();
      if(result&&!result.disabled&&Date.now()+0>0){
        await new Promise(r=>setTimeout(r,1000));
        if(!running)return false;
        const current=findResultButton();
        if(current&&!current.disabled){current.click();status("Generate completed — clicked Result.");return true;}
      }
    }
    status("Generate was clicked, but no Result button appeared within 90 seconds.");
    return false;
  }
  function fill(el,text){
    el.focus();
    if(el.isContentEditable)el.textContent=text;
    else{
      const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
      if(setter)setter.call(el,text);else el.value=text;
    }
    el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));
    el.dispatchEvent(new Event("change",{bubbles:true}));
  }
  function armSilence(){
    clearTimeout(silenceTimer);
    silenceTimer=setTimeout(()=>{if(running&&!busy&&finalText.trim())submitPhrase();},SILENCE_MS);
  }
  async function configureLocal(API){
    if(localChecked)return;
    localChecked=true;
    if(typeof API.available!=="function"||typeof API.install!=="function"){
      localMode=false;status("Offline recognition isn't available in this Chrome build. Trying Chrome's online speech service.");return;
    }
    const options={langs:["en-US"],processLocally:true,quality:"dictation"};
    try{
      let state=await API.available(options);
      if(state==="available"){localMode=true;status("Offline English recognition ready.");return;}
      if(state==="downloadable"||state==="downloading"){
        status("Downloading Chrome's offline English speech pack…");
        if(await API.install(options)){localMode=true;status("Offline English pack installed.");return;}
        throw new Error("Chrome could not install the offline speech pack.");
      }
      localMode=false;status("Offline English pack unavailable; trying online recognition.");
    }catch(e){localChecked=false;localMode=false;status("Offline setup failed: "+(e.message||e));}
  }
  function stopRecognition(){
    clearTimeout(restartTimer);clearTimeout(silenceTimer);
    const old=recognition;recognition=null;
    if(old){old.onend=null;try{old.stop();}catch{}}
  }
  async function startRecognition(){
    if(!running||busy||recognition)return;
    const API=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!API){status("SpeechRecognition is unavailable in this Chrome version.");return;}
    await configureLocal(API);
    if(!running||busy||recognition)return;
    try{
      const rec=new API();recognition=rec;
      rec.lang="en-US";rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1;
      if("processLocally" in rec)rec.processLocally=localMode;
      rec.onresult=e=>{
        let interim="";
        for(let i=e.resultIndex;i<e.results.length;i++){
          const phrase=(e.results[i][0]?.transcript||"").trim();if(!phrase)continue;
          if(e.results[i].isFinal){finalText=(finalText+" "+phrase).trim();status("Recognized: "+finalText.slice(-120));}
          else interim=phrase;
        }
        if(interim)status("Hearing: "+interim.slice(0,90));
        if(finalText)armSilence();
      };
      rec.onspeechend=()=>{if(finalText)armSilence();};
      rec.onsoundend=()=>{if(finalText)armSilence();};
      rec.onerror=e=>{
        if(e.error==="not-allowed"||e.error==="service-not-allowed"){status("Microphone/speech permission blocked. Allow microphone access for pocketweb.tools.");return;}
        if(e.error==="network"){
          retryCount++;
          status(localMode?"Offline recognition failed. Check Chrome's installed English speech pack.":"Speech service network error. Offline recognition is unavailable; check internet, VPN, firewall, or Chrome speech-service access.");
        }else if(e.error!=="no-speech"&&e.error!=="aborted")status("Speech recognition error: "+e.error);
      };
      rec.onend=()=>{
        if(recognition===rec)recognition=null;
        if(running&&!busy){clearTimeout(restartTimer);restartTimer=setTimeout(()=>startRecognition(),900);}
      };
      rec.start();status(localMode?"Listening offline…":"Listening…");
    }catch(e){recognition=null;status("Could not start recognition: "+(e.message||e));if(running)restartTimer=setTimeout(startRecognition,1500);}
  }
  async function submitPhrase(){
    if(!running||busy||!finalText.trim())return;
    const phrase=finalText.trim();finalText="";busy=true;stopRecognition();
    try{
      const box=findTextBox(),button=findGenerate();
      if(!box)throw new Error("Recognized speech, but couldn't find the text-to-speak box.");
      if(!button)throw new Error("Recognized speech, but couldn't find Generate Speech.");
      fill(box,phrase);await new Promise(r=>setTimeout(r,250));
      if(button.disabled)throw new Error("Text entered, but Generate is disabled.");
      button.click();status("Submitted: "+phrase.slice(0,100)+" — waiting for Result…");
      await waitForResultAndClick();
    }catch(e){status((e.message||"Submission failed")+" Transcript: "+phrase.slice(0,120));}
    await new Promise(r=>setTimeout(r,700));busy=false;if(running)startRecognition();
  }
  function start(){
    if(running)return "Already listening.";
    running=true;retryCount=0;status("Starting speech recognition…");startRecognition();return "Starting speech recognition…";
  }
  function stop(){running=false;busy=false;finalText="";stopRecognition();status("Stopped.");return "Stopped.";}
  chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{
    if(msg.action==="start")reply({status:start()});
    else if(msg.action==="stop")reply({status:stop()});
    else reply({status:window.__pocketWebDictationStatus||"Ready. Open PocketWebTools Voice Cloning."});
    return true;
  });
  status("Ready. Press the extension button and choose Start.");
})();