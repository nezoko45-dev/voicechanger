const http=require("http"),fs=require("fs"),path=require("path");
const PORT=8787,ROOT=__dirname;

async function uploadTemp(wav){
  const form=new FormData();
  form.append("file",new Blob([wav],{type:"audio/wav"}),"donor.wav");
  form.append("expire","3600");
  const r=await fetch("https://tmpfiles.org/api/v1/upload",{method:"POST",body:form});
  const text=await r.text();
  if(!r.ok)throw new Error("Temporary upload failed ("+r.status+"): "+text);
  let j;try{j=JSON.parse(text)}catch{throw new Error("Temporary upload returned invalid JSON: "+text)}
  const url=j?.data?.url;
  if(!url)throw new Error("Temporary upload did not return a file URL.");
  return url.replace("https://tmpfiles.org/","https://tmpfiles.org/dl/");
}

async function proxy(req,res){
  const key=req.headers["x-resemble-key"],voice=req.headers["x-resemble-voice"];
  if(!key||!voice){res.writeHead(400,{"Content-Type":"text/plain"});return res.end("Missing Resemble API key or target voice UUID.");}
  const chunks=[];for await(const c of req)chunks.push(c);const wav=Buffer.concat(chunks);
  try{
    const src=await uploadTemp(wav);
    const payload={
      voice_uuid:voice,
      data:"<speak><resemble:convert src=\""+src+""></resemble:convert></speak>",
      sample_rate:44100,
      output_format:"wav",
      precision:"PCM_16"
    };
    const r=await fetch("https://f.cluster.resemble.ai/synthesize",{
      method:"POST",
      headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    const text=await r.text();
    if(!r.ok){
      let msg=text;try{const j=JSON.parse(text);msg=j?.message||j?.error||text}catch{}
      throw new Error("Resemble ("+r.status+"): "+msg);
    }
    let j;try{j=JSON.parse(text)}catch{throw new Error("Resemble returned invalid JSON: "+text)}
    if(!j.audio_content)throw new Error(j.message||"Resemble returned no audio.");
    const audio=Buffer.from(j.audio_content,"base64");
    res.writeHead(200,{"Content-Type":"audio/wav","Cache-Control":"no-store"});
    res.end(audio);
  }catch(e){
    res.writeHead(502,{"Content-Type":"text/plain"});res.end(e.message||String(e));
  }
}

const server=http.createServer(async(req,res)=>{
  if(req.method==="POST"&&req.url==="/api/convert")return proxy(req,res);
  let p=req.url.split("?")[0];if(p==="/")p="/index.html";p=path.join(ROOT,p);
  if(!p.startsWith(ROOT)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.writeHead(404);return res.end("Not found");}
  const ext=path.extname(p),types={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json"};
  res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream"});fs.createReadStream(p).pipe(res);
});
server.listen(PORT,"127.0.0.1",()=>console.log("Resemble Voice Changer: http://127.0.0.1:"+PORT));
