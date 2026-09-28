const http=require("http"),fs=require("fs"),path=require("path");
const ROOT=__dirname,PORT=8787;
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,"http://127.0.0.1");
 if(u.pathname==="/health"){res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});return res.end(JSON.stringify({ok:true,audio:"chrome"}));}
 let file;try{file=u.pathname==="/"?"index.html":decodeURIComponent(u.pathname.slice(1));}catch{return res.writeHead(400).end();}
 const full=path.resolve(ROOT,file);
 if(!full.startsWith(path.resolve(ROOT))||!fs.existsSync(full)||fs.statSync(full).isDirectory()){res.writeHead(404);return res.end("Not found");}
 const ext=path.extname(full).toLowerCase(),types={".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".json":"application/json",".wav":"audio/wav"};
 res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Cache-Control":"no-store"});fs.createReadStream(full).pipe(res);
});
server.listen(PORT,"127.0.0.1",()=>console.log("PocketTTS Chrome audio: http://127.0.0.1:"+PORT));