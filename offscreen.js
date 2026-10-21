(() => {
 const SpeechRecognition=self.SpeechRecognition||self.webkitSpeechRecognition;
 let recognition=null,listening=false,starting=false,finalText="",interimText="",restartTimer=null,restartDelay=250,lastSubmitted="",lastSubmittedAt=0,submitInFlight=false;
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
  // Only submit when the user explicitly presses Stop. No silence timer:
  // keep the latest interim words until recognition has stopped and finalized its results.
  const phrase=(finalText+" "+interimText).replace(/\s+/g," ").trim();
  finalText="";interimText="";
  if(phrase)void submit(phrase);
 }
 function startRecognition(){
  if(!listening||recognition||!SpeechRecognition)return;
  const r=new SpeechRecognition();recognition=r;r.continuous=true;r.interimResults=true;r.lang="en-US";
  r.onstart=()=>{restartDelay=250;report("Listening. You can leave the TTSLab tab in the background.");};
  r.onresult=event=>{let interim="";for(let i=event.resultIndex;i<event.results.length;i++){const result=event.results[i],phrase=result[0]?.transcript||"";if(result.isFinal)finalText+=phrase+" ";else interim+=phrase;}interimText=interim;};
  r.onerror=event=>{
   if(["not-allowed","service-not-allowed"].includes(event.error)){
    listening=false;clearTimeout(restartTimer);report("Microphone permission denied. Allow microphone access for Chrome, then start again.");
   }else if(listening){
    report("Speech recognition interrupted ("+event.error+"); reconnecting…");
   }
  };
  r.onend=()=>{if(recognition===r)recognition=null;if(!listening){flush();report("Dictation stopped.");return;}clearTimeout(restartTimer);restartTimer=setTimeout(startRecognition,restartDelay);restartDelay=Math.min(1800,restartDelay*1.5);};
  try{r.start();}catch(error){recognition=null;if(listening){report("Recognition restart failed; retrying…");clearTimeout(restartTimer);restartTimer=setTimeout(startRecognition,600);}}
 }
 async function toggle(){
  if(!SpeechRecognition){report("SpeechRecognition isn't available in this Chrome build.");return{listening:false,message:"Speech recognition isn't available in this Chrome build."};}
  if(starting)return{listening,message:"Dictation is already starting."};
  if(listening){listening=false;clearTimeout(restartTimer);if(recognition){try{recognition.stop();}catch{flush();}}else flush();report("Stopping dictation…");return{listening:false,message:"Stopping dictation…"};}
  starting=true;
  try{listening=true;startRecognition();return{listening:true,message:"Starting dictation…"};}
  catch(error){listening=false;const message="Could not start speech recognition: "+(error?.message||String(error));report(message);return{listening:false,message};}
  finally{starting=false;}
 }
 chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="TT_OFFSCREEN_TOGGLE"){toggle().then(sendResponse);return true;}
  if(message?.type==="TT_OFFSCREEN_STATUS")sendResponse({listening,message:listening?"Listening in background.":"Dictation is stopped."});
 });
})();
