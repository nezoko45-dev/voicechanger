(() => {
if(window.__voiceDictatorLoaded)return;window.__voiceDictatorLoaded=true;
let active=false,recognition=null,waiting=false,lastAssistantText="",pollTimer=null,readTimer=null;
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
function status(s){chrome.runtime.sendMessage({type:"STATUS",status:s}).catch(()=>{});console.log("[Voice Dictator]",s)}
function composer(){return document.querySelector("#prompt-textarea")||document.querySelector('[contenteditable="true"][data-testid="composer"]')||document.querySelector('div[contenteditable="true"]. ProseMirror')}
function getComposer(){return document.querySelector("#prompt-textarea")||document.querySelector('[contenteditable="true"][data-testid="composer"]')||document.querySelector('div[contenteditable="true"]')}
function setText(el,text){el.focus();if(el.tagName==="TEXTAREA"){const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;setter.call(el,text);el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}))}else{document.execCommand("insertText",false,text);if(!el.textContent.trim())el.textContent=text;el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}))}}
function sendMessage(){const b=document.querySelector('button[data-testid="send-button"]')||[...document.querySelectorAll("button")].find(x=>/send/i.test(x.getAttribute("aria-label")||"")&&!x.disabled);if(b&&!b.disabled){b.click();return true}return false}
function startRecognition(){if(!active||waiting||!SR)return;try{recognition=new SR();recognition.lang="en-US";recognition.continuous=false;recognition.interimResults=false;recognition.maxAlternatives=1;
recognition.onresult=e=>{const text=e.results[e.results.length-1][0].transcript.trim();if(!text||!active)return;const el=getComposer();if(!el){status("Can't find ChatGPT message box.");restartListen();return}setText(el,text);waiting=true;status("Sending: "+text);setTimeout(()=>{if(sendMessage()){status("Sent. Waiting for ChatGPT response…");waitForAnswer()}else{waiting=false;status("Send button not found.");restartListen()}},250)};
recognition.onerror=e=>{status("Speech recognition: "+e.error);if(active&&!waiting)setTimeout(startRecognition,900)};
recognition.onend=()=>{if(active&&!waiting)setTimeout(startRecognition,350)};
recognition.start();status("Listening… speak a sentence.")}catch(e){status("Mic start failed: "+e.message);setTimeout(startRecognition,1200)}}
function restartListen(){waiting=false;if(active)setTimeout(startRecognition,500)}
function assistantMessages(){return [...document.querySelectorAll('[data-message-author-role="assistant"]')]}
function waitForAnswer(){let prior=assistantMessages().length,seenText="",stable=0;clearInterval(pollTimer);pollTimer=setInterval(()=>{if(!active){clearInterval(pollTimer);return}
const msgs=assistantMessages(),last=msgs.at(-1);if(!last||msgs.length<=prior){return}
const text=last.innerText.trim();const stopBtn=[...document.querySelectorAll("button")].find(b=>/stop generating/i.test(b.getAttribute("aria-label")||""));
if(text&&text===seenText)stable++;else{seenText=text;stable=0}
if(text&&stable>=3&&!stopBtn){clearInterval(pollTimer);lastAssistantText=text;clickReadAloud(last);}},1000)}
function clickReadAloud(message){if(!active)return;status("Response ready. Starting Read Aloud…");
const buttons=[...message.querySelectorAll("button")];let read=buttons.find(b=>/read aloud|speaker|listen/i.test((b.getAttribute("aria-label")||"")+" "+(b.getAttribute("data-testid")||"")));
if(!read){read=[...document.querySelectorAll("button")].find(b=>/read aloud/i.test(b.getAttribute("aria-label")||""))}
if(read){read.click();status("Read Aloud playing. Waiting for playback to finish…");monitorPlayback()}else{status("Couldn't locate Read Aloud; restarting mic.");restartListen()}}
function monitorPlayback(){let last=0,stable=0;clearInterval(readTimer);readTimer=setInterval(()=>{if(!active){clearInterval(readTimer);return}
const stop=[...document.querySelectorAll("button")].find(b=>/stop reading|stop playback|pause/i.test(b.getAttribute("aria-label")||""));
const audio=[...document.querySelectorAll("audio")].find(a=>!a.paused&&!a.ended);
if(stop||audio){stable=0;return}
stable++;if(stable>=4){clearInterval(readTimer);status("Read Aloud finished. Listening again…");restartListen()}},1000)}
chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{if(msg.action==="START"){if(!SR){reply({status:"Chrome Speech Recognition unavailable. Use Chrome."});return}active=true;waiting=false;startRecognition();reply({status:"Loop started. Grant microphone access if prompted."})}else if(msg.action==="STOP"){active=false;waiting=false;recognition?.stop();clearInterval(pollTimer);clearInterval(readTimer);status("Stopped.");reply({status:"Stopped."})}return true});
})();