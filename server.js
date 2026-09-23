const http=require("http"),fs=require("fs"),path=require("path");
const PORT=8787, ROOT=__dirname;
async function proxy(req,res){
  const key=req.headers["x-cartesia-key"], voice=req.headers["x-cartesia-voice"];
  if(!key||!voice){res.writeHead(400,{"Content-Type":"text/plain"});return res.end("Missing Cartesia API key or voice ID.");}
  const chunks=[];for await(const c of req)chunks.push(c);const audio=Buffer.concat(chunks);
  const form=new FormData();
  form.append("clip",new Blob([audio],{type:req.headers["content-type"]||"audio/webm"}),"mic.webm");
  form.append("voice_id",voice);
  form.append("output_format[container]","raw");
  form.append("output_format[sample_rate]","48000");
  form.append("output_format[encoding]","pcm_s16le");
  try{
    const r=await fetch("https://api.cartesia.ai/voice-changer/bytes",{method:"POST",headers:{"Authorization":"Bearer "+key,"Cartesia-Version":"2026-03-01"},body:form});
    const data=Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status,{"Content-Type":r.headers.get("content-type")||"application/octet-stream","Cache-Control":"no-store"});
    res.end(data);
  }catch(e){res.writeHead(502,{"Content-Type":"text/plain"});res.end("Cartesia proxy error: "+e.message)}
}
const server=http.createServer(async(req,res)=>{
  if(req.method==="POST"&&req.url==="/api/convert")return proxy(req,res);
  let p=req.url.split("?")[0];if(p==="/")p="/index.html";p=path.join(ROOT,p);
  if(!p.startsWith(ROOT)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.writeHead(404);return res.end("Not found");}
  const ext=path.extname(p),types={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json"};
  res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream"});fs.createReadStream(p).pipe(res);
});
server.listen(PORT,"127.0.0.1",()=>console.log("Voice changer: http://127.0.0.1:"+PORT));
