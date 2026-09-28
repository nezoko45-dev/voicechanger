const http=require("http"),fs=require("fs"),path=require("path"),os=require("os"),{spawn}=require("child_process");
const ROOT=__dirname,PORT=8787;let playing=Promise.resolve(),counter=0;
function json(res,code,data){res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(data));}
function playWav(buffer){
 const file=path.join(os.tmpdir(),"pockettts-"+process.pid+"-"+(++counter)+".wav");fs.writeFileSync(file,buffer);
 return new Promise((resolve,reject)=>{
  const safe=file.replace(/'/g,"''");
  const script="$p=New-Object System.Media.SoundPlayer('"+safe+"');$p.Load();$p.PlaySync();$p.Dispose();Remove-Item -LiteralPath '"+safe+"' -Force -ErrorAction SilentlyContinue";
  const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command",script],{windowsHide:true});let err="";
  child.stderr.on("data",d=>err+=d.toString());child.on("error",e=>{try{fs.unlinkSync(file)}catch{}reject(e);});
  child.on("close",code=>{try{fs.unlinkSync(file)}catch{};code===0?resolve():reject(new Error(err||"Windows audio player exited with code "+code));});
 });
}
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,"http://127.0.0.1");
 if(u.pathname==="/play"&&req.method==="POST"){let body="";req.on("data",c=>{body+=c;if(body.length>20e6)req.destroy();});req.on("end",async()=>{try{const j=JSON.parse(body||"{}");if(!j.wavBase64)throw new Error("No WAV audio received.");const wav=Buffer.from(j.wavBase64,"base64");if(wav.length<44||wav.slice(0,4).toString()!=="RIFF")throw new Error("Invalid WAV data.");playing=playing.then(()=>playWav(wav));await playing;json(res,200,{ok:true});}catch(e){json(res,500,{error:e.message||"Windows playback failed."});}});return;}
 if(u.pathname==="/health")return json(res,200,{ok:true,audio:"windows-default"});
 let file;try{file=u.pathname==="/"?"index.html":decodeURIComponent(u.pathname.slice(1));}catch{return res.writeHead(400).end();}
 const full=path.resolve(ROOT,file);if(!full.startsWith(path.resolve(ROOT))||!fs.existsSync(full)||fs.statSync(full).isDirectory()){res.writeHead(404);return res.end("Not found");}
 const ext=path.extname(full).toLowerCase(),types={".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".json":"application/json",".wav":"audio/wav"};
 res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream"});fs.createReadStream(full).pipe(res);
});
server.listen(PORT,"127.0.0.1",()=>console.log("PocketTTS Windows audio: http://127.0.0.1:"+PORT));