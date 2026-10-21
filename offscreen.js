(() => {
 const SpeechRecognition=self.SpeechRecognition||self.webkitSpeechRecognition;
 let recognition=null,listening=false,starting=false,finalText="",interimText="",restartTimer=null,utteranceTimer=null,restartDelay=400,lastSubmitted="",lastSubmittedAt=0,submitInFlight=false,stopRequested=false,lastError="";
  function report(message){chrome.runtime.sendMessage({type:"TT_FAST_STATUS",listening,message}).catch(()=>{});}
 async function submit(text){
  const phrase=String(text||"").replace(/\s+/g," ").trim();if(!phrase)return;
  const now=Date.now();if(submitInFlight||(phrase.toLowerCase()===lastSubmitted.toLowerCase()&&now-lastSubmittedAt<5000))return;
  submitInFlight=true;lastSubmitted=phrase;lastSubmittedAt=now;
  try{const result=await chrome.runtime.sendMessage({type:"TT_FAST_SUBMIT",text:phrase});report(result?.message||(result?.ok?"Submitted phrase.":"Phrase wasn't submitted."));}
  catch(error){report("Submission failed: "+(error?.message||String(error)));}
  finally{submitInFlight=false;}
 }
 function flush(){
  clearTimeout(utteranceTimer);
  const phrase=(finalText+" "+interimText).replace(/\s+/g," ").trim();
  finalText="";interimText="";
  if(phrase)void submit(phrase);
 }
 function startRecognition(){
  if(!listening||stopRequested||recognition||!SpeechRecognition)return;
  const r=new SpeechRecognition();recognition=r;r.continuous=true;r.interimResults=true;r.lang="en-US";
  r.onstart=()=>{restartDelay=400;lastError="";report("Listening. You can leave the TTSLab tab in the background.");};
  r.onresult=event=>{
   let interim="",gotFinal=false;
   for(let i=event.resultIndex;i<event.results.length;i++){
    const result=event.results[i],phrase=result[0]?.transcript||"";
    if(result.isFinal){finalText+=phrase+" ";gotFinal=true;}else interim+=phrase;
   }
   interimText=interim;
   const liveText=(finalText+" "+interimText).replace(/\s+/g," ").trim();
   chrome.runtime.sendMessage({type:"TT_FAST_PREVIEW",text:liveText}).catch(()=>{});
   if(gotFinal){
    clearTimeout(utteranceTimer);
    utteranceTimer=setTimeout(()=>{const phrase=finalText.trim();finalText="";interimText="";if(phrase)void submit(phrase);},1200);
   }
  };
  r.onerror=event=>{
   const code=String(event?.error||"unknown");lastError=code;
   if(["not-allowed","service-not-allowed"].includes(code)){
    listening=false;stopRequested=true;clearTimeout(restartTimer);
    report("Chrome blocked speech recognition ("+code+"). Allow microphone access for Chrome, then press Start listening again.");
   }else if(listening){
    report("Speech recognition interrupted ("+code+"); reconnecting…");
   }
  };
  r.onend=()=>{
   if(recognition===r)recognition=null;
   if(!listening||stopRequested){flush();report(lastError==="not-allowed"||lastError==="service-not-allowed"?"Speech recognition needs microphone permission. Allow access, then press Start listening again.":"Dictation stopped.");return;}
   clearTimeout(restartTimer);
   report(lastError==="no-speech"?"Still listening — reconnecting after a pause…":"Speech recognition ended unexpectedly; reconnecting…");
   restartTimer=setTimeout(()=>{if(listening&&!stopRequested&&!recognition)startRecognition();},restartDelay);
   restartDelay=Math.min(4000,Math.round(restartDelay*1.7));
  };
  try{r.start();}catch(error){recognition=null;if(listening){report("Recognition restart failed; retrying…");clearTimeout(restartTimer);restartTimer=setTimeout(startRecognition,Math.max(800,restartDelay));}}
 }
 async function toggle(){
  if(!SpeechRecognition){report("SpeechRecognition isn't available in this Chrome build.");return{listening:false,message:"Speech recognition isn't available in this Chrome build."};}
  if(starting)return{listening,message:"Dictation is already starting."};
  if(listening){stopRequested=true;listening=false;clearTimeout(restartTimer);if(recognition){try{recognition.stop();}catch{recognition=null;flush();report("Dictation stopped.");}}else{flush();report("Dictation stopped.");}return{listening:false,message:"Stopping dictation and submitting your words…"};}
  starting=true;
  try{stopRequested=false;lastError="";listening=true;restartDelay=400;startRecognition();return{listening:true,message:"Starting dictation…"};}
  catch(error){listening=false;const message="Could not start speech recognition: "+(error?.message||String(error));report(message);return{listening:false,message};}
  finally{starting=false;}
 }
 chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="TT_OFFSCREEN_TOGGLE"){toggle().then(sendResponse);return true;}
  if(message?.type==="TT_OFFSCREEN_STATUS")sendResponse({listening,message:listening?"Listening in background.":"Dictation is stopped."});
 });
})();
