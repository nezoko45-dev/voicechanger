import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PORT=8765;

const MIME={
  ".html":"text/html; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".wav":"audio/wav"
};

function reply(res,status,data){
  res.writeHead(status,{
    "Content-Type":"application/json; charset=utf-8",
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Headers":"content-type"
  });
  res.end(JSON.stringify(data));
}

const server=http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS"){
    res.writeHead(204,{
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Headers":"content-type"
    });
    return res.end();
  }

  const pathname=decodeURIComponent(
    new URL(req.url||"/","http://127.0.0.1:"+PORT).pathname
  );

  // The browser now owns the complete OpenVoice/audio pipeline.
  // This Node process only provides the local HTML app so there is
  // no WASAPI/audify/onnxruntime-node backend to conflict with Chrome.
  if(pathname==="/health"&&req.method==="GET"){
    return reply(res,200,{ok:true,mode:"browser-openvoice",audioBackend:"chrome"});
  }

  if(req.method==="GET"){
    const relative=pathname==="/"?"/index.html":pathname;
    const file=path.resolve(ROOT, "."+relative);
    const rootWithSep=ROOT.endsWith(path.sep)?ROOT:ROOT+path.sep;

    if(
      (file===ROOT||file.startsWith(rootWithSep)) &&
      file!==path.join(ROOT,"server.mjs")
    ){
      try{
        const data=await fs.readFile(file);
        res.writeHead(200,{
          "Content-Type":MIME[path.extname(file).toLowerCase()]||"application/octet-stream",
          "Cache-Control":"no-store"
        });
        return res.end(data);
      }catch{}
    }
  }

  return reply(res,404,{ok:false,error:"Not found"});
});

server.listen(PORT,"127.0.0.1",()=>{
  console.log("VoiceChanger ready: http://127.0.0.1:"+PORT);
  console.log("Audio backend: Chrome/OpenVoice only (no audify/WASAPI/Node ONNX).");
});
