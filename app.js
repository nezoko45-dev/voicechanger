let mic;
let inputStream;
let inputDevice;
let outputAudio;
let outputDestination;
let pitchShift;
let highpass;
let lowpass;
let compressor;
let eq;
let gain;
let running=false;

const $=id=>document.getElementById(id);

function setStatus(text,on=false){
  $("status").textContent=text;
  $("status").className="status"+(on?" on":"");
}

async function loadDevices(){
  const permission=await navigator.mediaDevices.getUserMedia({audio:true});
  permission.getTracks().forEach(t=>t.stop());

  const devices=await navigator.mediaDevices.enumerateDevices();
  const oldIn=$("input").value;
  const oldOut=$("output").value;

  $("input").innerHTML="";
  $("output").innerHTML="";

  devices.filter(d=>d.kind==="audioinput").forEach((d,i)=>{
    const o=document.createElement("option");
    o.value=d.deviceId;
    o.textContent=d.label||`Microphone ${i+1}`;
    $("input").appendChild(o);
  });

  devices.filter(d=>d.kind==="audiooutput").forEach((d,i)=>{
    const o=document.createElement("option");
    o.value=d.deviceId;
    o.textContent=d.label||`Output ${i+1}`;
    $("output").appendChild(o);
  });

  if([...$("input").options].some(o=>o.value===oldIn)) $("input").value=oldIn;
  if([...$("output").options].some(o=>o.value===oldOut)) $("output").value=oldOut;
}

function updateEffect(){
  if(!pitchShift) return;

  const amount=Number($("uwu").value)/100;
  const pitch=Number($("pitch").value);

  pitchShift.pitch=pitch;
  pitchShift.wet=0.72+amount*0.28;

  highpass.frequency=120+amount*100;
  lowpass.frequency=11000+amount*3000;

  // Gentle presence boost without the harsh "chipmunk" sound.
  eq.low=1.5+amount*1.5;
  eq.mid=2+amount*3;
  eq.high=1+amount*2;

  compressor.threshold=-26+amount*5;
  gain.gain.value=0.82;
}

async function start(){
  if(running) return;

  try{
    await Tone.start();

    const deviceId=$("input").value;
    const outputId=$("output").value;

    inputStream=await navigator.mediaDevices.getUserMedia({
      audio:{
        deviceId:deviceId?{exact:deviceId}:undefined,
        channelCount:1,
        echoCancellation:false,
        noiseSuppression:false,
        autoGainControl:false
      }
    });

    const ctx=Tone.getContext();

    // Prefer Chrome's native AudioContext output routing when available.
    const nativeContext=ctx.rawContext || ctx._nativeContext || ctx;
    if(outputId && typeof nativeContext.setSinkId==="function"){
      try{
        await nativeContext.setSinkId(outputId);
      }catch(e){
        console.warn("Output selection failed:",e);
      }
    }

    mic=new Tone.UserMedia();
    await mic.open(deviceId||undefined);

    highpass=new Tone.Filter({
      type:"highpass",
      frequency:180,
      rolloff:-12
    });

    lowpass=new Tone.Filter({
      type:"lowpass",
      frequency:12000,
      rolloff:-12
    });

    pitchShift=new Tone.PitchShift({
      pitch:3.2,
      windowSize:0.08,
      delayTime:0,
      feedback:0,
      wet:1
    });

    eq=new Tone.EQ3({
      low:2,
      mid:3,
      high:2
    });

    compressor=new Tone.Compressor({
      threshold:-22,
      ratio:3,
      attack:0.01,
      release:0.12
    });

    gain=new Tone.Gain(0.82);

    // Tone.js native destination is replaced by our selected Windows sink.
    mic.chain(highpass,lowpass,pitchShift,eq,compressor,gain, Tone.getDestination());

    updateEffect();

    running=true;
    setStatus("🎀 Uwu girl voice is LIVE",true);
  }catch(err){
    console.error(err);
    setStatus("Could not start: "+(err.message||err),false);
    stop();
  }
}

function stop(){
  running=false;

  try{mic?.disconnect();}catch{}
  try{mic?.close();}catch{}
  try{inputStream?.getTracks().forEach(t=>t.stop());}catch{}

  [highpass,lowpass,pitchShift,eq,compressor,gain].forEach(n=>{
    try{n?.dispose();}catch{}
  });

  mic=null;
  inputStream=null;
  highpass=null;
  lowpass=null;
  pitchShift=null;
  eq=null;
  compressor=null;
  gain=null;

  setStatus("Stopped.");
}

$("start").onclick=start;
$("stop").onclick=stop;
$("uwu").oninput=updateEffect;
$("pitch").oninput=updateEffect;

navigator.mediaDevices.addEventListener?.("devicechange",()=>{
  loadDevices().catch(()=>{});
});

loadDevices().then(()=>{
  setStatus("Ready — press Start.");
}).catch(()=>{
  setStatus("Allow microphone access, then reload the page.");
});
