(() => {
 const button=document.querySelector("#toggle"),status=document.querySelector("#status");
 function render(result){const active=!!result?.listening;button.textContent=active?"■ Stop listening":"▶ Start listening";button.classList.toggle("stop",active);status.textContent=result?.message||(active?"Listening.":"Ready.");}
 async function send(type){button.disabled=true;try{render(await chrome.runtime.sendMessage({type}));}catch(error){status.textContent="Could not contact dictation: "+(error?.message||String(error));}finally{button.disabled=false;}}
 button.addEventListener("click",()=>send("TT_FAST_TOGGLE"));
 chrome.runtime.onMessage.addListener(message=>{if(message?.type==="TT_FAST_STATUS")render(message);});
 send("TT_FAST_STATUS");
})();
