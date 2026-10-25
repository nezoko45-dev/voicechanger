const status=document.getElementById('status');
async function send(action){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab||!tab.id||!/^https:\/\/(?:[^/]+\.)?(?:character\.ai|talkie-ai\.com)\//i.test(tab.url||'')){status.textContent='Open a Talkie or Character.AI chat tab first.';return}
  try{
    const result=await chrome.tabs.sendMessage(tab.id,{action});
    status.textContent=result?.message||'Command sent.';
  }catch(e){status.textContent='Refresh the Talkie/Character.AI tab, then try again.'}
}
document.getElementById('start').addEventListener('click',()=>send('START'));
document.getElementById('stop').addEventListener('click',()=>send('STOP'));
