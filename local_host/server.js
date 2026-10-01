const http=require('http');
const {WebSocketServer}=require('ws');
const PORT=8765;
const HOST='127.0.0.1';
const server=http.createServer((req,res)=>{
  res.writeHead(200,{
    'Content-Type':'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'Cache-Control':'no-store'
  });
  res.end('Pocket TTS local host is running. WebSocket: ws://127.0.0.1:8765\n');
});
const wss=new WebSocketServer({server,host:HOST});
wss.on('connection',(ws)=>{
  console.log('GitHub Pages client connected.');
  ws.send(JSON.stringify({type:'ready',message:'local voice host connected'}));
  ws.on('message',(raw)=>{
    let msg;try{msg=JSON.parse(raw.toString())}catch{return}
    if(msg.type==='ping')ws.send(JSON.stringify({type:'pong'}));
    else if(msg.type==='load-reference')ws.send(JSON.stringify({type:'reference-ready',name:msg.name||'reference.wav'}));
    else if(msg.type==='speak')ws.send(JSON.stringify({type:'error',message:'Local host connected. Native Pocket TTS inference is not installed in this Node host yet.'}));
  });
  ws.on('close',()=>console.log('GitHub Pages client disconnected.'));
});
server.on('error',(e)=>{console.error('Server error:',e.message);process.exitCode=1});
server.listen(PORT,HOST,()=>console.log(`Pocket TTS local host listening on ws://${HOST}:${PORT}`));
