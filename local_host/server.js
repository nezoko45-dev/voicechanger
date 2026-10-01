const http=require('http');
const fs=require('fs');
const path=require('path');
const {WebSocketServer}=require('ws');
const PORT=8765;
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Access-Control-Allow-Origin':'*'});res.end('Pocket TTS local host is running.\n')});
const wss=new WebSocketServer({server});
let clients=new Set();
wss.on('connection',ws=>{clients.add(ws);ws.send(JSON.stringify({type:'ready',message:'local voice host connected'}));ws.on('message',async data=>{let msg;try{msg=JSON.parse(data.toString())}catch{return}if(msg.type==='ping')ws.send(JSON.stringify({type:'pong'}));if(msg.type==='speak')ws.send(JSON.stringify({type:'error',message:'TTS engine bridge is ready, but Pocket TTS native inference is not bundled yet. Keep the GitHub Pages engine enabled until the native Pocket TTS runtime is installed.'}));if(msg.type==='load-reference')ws.send(JSON.stringify({type:'reference-ready',name:msg.name||'reference.wav'}));});ws.on('close',()=>clients.delete(ws))});server.listen(PORT,'127.0.0.1',()=>console.log(`Pocket TTS local host listening on ws://127.0.0.1:${PORT}`));
