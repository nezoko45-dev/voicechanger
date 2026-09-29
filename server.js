const http=require("http");
const fs=require("fs");
const path=require("path");

const ROOT=__dirname;
const PORT=8787;
const MIME={
 ".html":"text/html; charset=utf-8",
 ".js":"application/javascript; charset=utf-8",
 ".json":"application/json",
 ".css":"text/css; charset=utf-8",
 ".wav":"audio/wav",
 ".onnx":"application/octet-stream",
 ".bin":"application/octet-stream",
 ".npy":"application/octet-stream"
};

const server=http.createServer((req,res)=>{
 let pathname;
 try{pathname=new URL(req.url,"http://127.0.0.1").pathname;}catch{res.writeHead(400);return res.end("Bad request");}
 if(pathname==="/health"){
  res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
  return res.end(JSON.stringify({ok:true,app:"deepgram-pockettts-chrome"}));
 }
 let relative;
 try{relative=decodeURIComponent(pathname==="/"?"index.html":pathname.slice(1));}catch{res.writeHead(400);return res.end("Bad request");}
 const full=path.resolve(ROOT,relative);
 if(full!==ROOT&&!full.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end("Forbidden");}
 if(!fs.existsSync(full)||fs.statSync(full).isDirectory()){res.writeHead(404);return res.end("Not found");}
 const ext=path.extname(full).toLowerCase();
 res.writeHead(200,{
  "Content-Type":MIME[ext]||"application/octet-stream",
  "Cache-Control":"no-store"
 });
 fs.createReadStream(full).pipe(res);
});

server.listen(PORT,"127.0.0.1",()=>{
 console.log("");
 console.log("==============================================");
 console.log(" Deepgram + PocketTTS Chrome Voice Changer");
 console.log(" http://127.0.0.1:"+PORT+"/");
 console.log("==============================================");
 console.log("Audio stays in Chrome. No Windows speaker backend.");
 console.log("Press Ctrl+C to stop.");
});
