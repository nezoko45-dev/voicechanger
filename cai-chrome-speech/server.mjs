import http from 'node:http';
import fs from 'node:fs';
const PORT=8787,CDP='http://127.0.0.1:9222';let ws,seq=0,pending=new Map(),attachState='starting',targetUrl='';
const send=(method,params={})=>new Promise((resolve,reject)=>{if(!ws||ws.readyState!==1)return reject(Error('CDP socket is not open'));let id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(Error(method+' timeout'))}},5000)});
async function attach(){try{
 const pages=await(await fetch(CDP+'/json/list')).json();
 const all=pages.filter(x=>x.type==='page');
 const p=all.find(x=>/character\.ai/i.test(x.url))||all.find(x=>!/(localhost|127\.0\.0\.1):8787/i.test(x.url));
 if(!p){attachState='Chrome debug is up, but no normal page target found. Open Character.AI in this Chrome window.';setTimeout(attach,1200);return}
 if(ws&&ws.readyState===1&&targetUrl===p.url){attachState='Connected: '+p.url;return}
 if(ws)try{ws.close()}catch{}
 targetUrl=p.url;attachState='Connecting to '+p.url;
 ws=new WebSocket(p.webSocketDebuggerUrl);
 ws.onmessage=e=>{let m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){let q=pending.get(m.id);pending.delete(m.id);m.error?q.reject(Error(m.error.message)):q.resolve(m.result)}};
 ws.onopen=async()=>{try{await send('Runtime.enable');attachState='Connected: '+p.url;console.log(attachState)}catch(e){attachState='CDP enable failed: '+e.message}};
 ws.onerror=()=>{attachState='WebSocket error. Relaunch Chrome using the updated start.bat.'};
 ws.onclose=()=>{attachState='Disconnected; reconnecting…';ws=null;setTimeout(attach,1000)};
 }catch(e){attachState='Chrome debug connection failed: '+e.message+' (check port 9222)';setTimeout(attach,1500)}}
async function insert(text){if(!ws||ws.readyState!==1)throw Error(attachState);let expr='(()=>{const t=document.querySelector("textarea");if(!t)return "NO_TEXTAREA";Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(t,'+JSON.stringify(text)+');t.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:'+JSON.stringify(text)+'}));t.focus();return "INSERTED"})()';let r=await send('Runtime.evaluate',{expression:expr,returnByValue:true});if(r.result?.value==='NO_TEXTAREA')throw Error('Attached to '+targetUrl+' but textbox not found. Click into a Character.AI chat first.');return r.result?.value}
http.createServer((req,res)=>{if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(fs.readFileSync('controller.html'));return}
if(req.method==='GET'&&req.url==='/status'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({state:attachState,url:targetUrl,targets:[] }));return}
if(req.method==='POST'&&req.url==='/transcript'){let b='';req.on('data',x=>b+=x);req.on('end',async()=>{try{let {text}=JSON.parse(b);await insert(text.trim());res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,state:attachState}));console.log('Inserted:',text)}catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:e.message,state:attachState}));console.error(e.message)}});return}
res.writeHead(404);res.end()}).listen(PORT,'127.0.0.1',()=>{console.log('Controller: http://127.0.0.1:'+PORT);attach()});
