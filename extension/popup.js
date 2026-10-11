const enabledInput=document.getElementById('enabled');
const delayInput=document.getElementById('delay');
const delayValue=document.getElementById('delayValue');
const onceButton=document.getElementById('once');
const statusEl=document.getElementById('status');
let activeTabId=null;
function say(text){statusEl.textContent=text}
async function getTab(){const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});return tabs[0]}
async function sendSettings(){if(activeTabId==null)return;try{await chrome.tabs.sendMessage(activeTabId,{type:'SETTINGS',enabled:enabledInput.checked,delayMs:Number(delayInput.value)*1000})}catch{say('Refresh your Fish Audio tab, then reopen this popup.')}}
async function init(){
  const saved=await chrome.storage.local.get({autoClick:false,delaySeconds:1});
  enabledInput.checked=saved.autoClick;
  delayInput.value=String(saved.delaySeconds);
  delayValue.textContent=Number(saved.delaySeconds).toFixed(1)+' s';
  const tab=await getTab();
  if(!tab?.id||!tab.url||!/^https:\/\/(?:[^/]+\.)?fish\.audio\//i.test(tab.url)){
    onceButton.disabled=true;enabledInput.disabled=true;delayInput.disabled=true;
    say('Open a Fish Audio page to use this extension.');return;
  }
  activeTabId=tab.id;
  await sendSettings();
  say(saved.autoClick?'Auto-click is enabled on this tab.':'Ready. Turn on Auto-click or click once.');
}
enabledInput.addEventListener('change',async()=>{
  await chrome.storage.local.set({autoClick:enabledInput.checked});
  await sendSettings();
  say(enabledInput.checked?'Auto-click enabled. Waiting for Call again…':'Auto-click paused.');
});
delayInput.addEventListener('input',()=>{
  delayValue.textContent=Number(delayInput.value).toFixed(1)+' s';
});
delayInput.addEventListener('change',async()=>{
  await chrome.storage.local.set({delaySeconds:Number(delayInput.value)});
  await sendSettings();
});
onceButton.addEventListener('click',async()=>{
  if(activeTabId==null)return;
  try{const result=await chrome.tabs.sendMessage(activeTabId,{type:'CLICK_ONCE',delayMs:Number(delayInput.value)*1000});say(result?.ok?'Clicked Call again.':(result?.error||'Could not find an enabled Call again button.'))}
  catch{say('Refresh the Fish Audio tab and try again.')}
});
init().catch(()=>say('Could not connect to the active tab.'));
