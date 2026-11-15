using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace CaiReplyAudioClicker
{
    internal static class Program
    {
        static readonly HttpClient Http = new HttpClient();
        static int commandId;
        const string DebugAddress = "http://127.0.0.1:9222";
        const string CaiUrl = "https://character.ai/";
        static bool voiceEnabled;
        static string lastBridgeStatus = "";

        static async Task Main()
        {
            Console.Title = "CAI Voice Toggle - In-Tab Speech Bridge";
            Console.WriteLine("Launching Chrome debug + Character.AI...");
            await EnsureDebugChrome();
            Console.WriteLine("Speech recognition is injected INSIDE the Character.AI tab. No separate speech tab.");
            Console.WriteLine("Allow microphone permission if Chrome asks. Ctrl+C exits.");
            bool wasPlaying=false; int quietAudioTicks=0;
            while(true)
            {
                try
                {
                    var target=await GetCaiTarget();
                    if(target!=null)
                    {
                        using var ws=new ClientWebSocket();
                        await ws.ConnectAsync(new Uri(target),CancellationToken.None);
                        string bridge=await Evaluate(ws, @"(() => {
                          const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
                          if(!SR) return 'SpeechRecognition-unavailable';
                          let b=window.__caiSpeechBridge;
                          if(!b){
                            const r=new SR();r.continuous=true;r.interimResults=false;r.lang='en-US';
                            b=window.__caiSpeechBridge={recognition:r,latest:'',status:'created',restartAt:0};
                            r.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)b.latest=e.results[i][0].transcript.trim();};
                            r.onerror=e=>{b.status='error:'+e.error;b.restartAt=Date.now()+1200;};
                            r.onstart=()=>{b.status='listening';b.restartAt=0;};
                            r.onend=()=>{b.status='ended';b.restartAt=Date.now()+900;};
                          }
                          if((b.status==='created'||b.status==='ended'||b.status.startsWith('error:')||b.status.startsWith('start-error:'))&&Date.now()>=(b.restartAt||0)){
                            try{b.status='starting';b.recognition.start();return 'restart-attempt';}
                            catch(e){b.status='start-error:'+e.message;b.restartAt=Date.now()+1500;}
                          }
                          return b.status;
                        })()");
                        if(bridge!=lastBridgeStatus){Console.WriteLine("Speech bridge: "+bridge);lastBridgeStatus=bridge;}
                        string words=await Evaluate(ws,"(()=>{const b=window.__caiSpeechBridge;if(!b)return '';const t=b.latest||'';b.latest='';return t;})()");
                        if(!string.IsNullOrWhiteSpace(words)){Console.WriteLine("Recognized: "+words);string sent=await SendChatMessage(ws,words);Console.WriteLine("Chat send: "+sent);await SetVoiceToggle(true,ws);}
                        string audio=await Evaluate(ws,@"(()=>{const a=[...document.querySelectorAll('audio,video')];return a.some(x=>!x.paused&&!x.ended&&x.currentTime>0&&!x.muted&&x.volume>0)?'playing':'silent';})()");
                        if(audio=="playing"){wasPlaying=true;quietAudioTicks=0;}
                        else if(wasPlaying){quietAudioTicks++;if(quietAudioTicks>=3){await SetVoiceToggle(false,ws);wasPlaying=false;quietAudioTicks=0;}}
                        await ws.CloseAsync(WebSocketCloseStatus.NormalClosure,"poll",CancellationToken.None);
                    }else Console.WriteLine("Waiting for Character.AI tab...");
                }catch(Exception ex){Console.WriteLine("Monitor/bridge: "+ex.Message);}
                await Task.Delay(700);
            }
        }

        static async Task<string> SendChatMessage(ClientWebSocket ws,string text)
        {
            string encoded=JsonSerializer.Serialize(text);
            return await Evaluate(ws, @"(() => {
              const msg="+encoded+@";
              const els=[...document.querySelectorAll('textarea,input,[contenteditable=true],[role=textbox]')].filter(e=>e.offsetWidth||e.offsetHeight||e.getClientRects().length);
              const box=els.find(e=>/message|chat|reply|type/i.test((e.getAttribute('placeholder')||'')+' '+(e.getAttribute('aria-label')||'')))||els[els.length-1];
              if(!box)return 'chat-input-not-found';
              box.focus();
              if(box.tagName==='TEXTAREA'||box.tagName==='INPUT'){
                const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box),'value')?.set;
                if(setter)setter.call(box,msg);else box.value=msg;
                box.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:msg}));
              }else{
                box.textContent=msg;
                box.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:msg}));
              }
              const form=box.closest('form');
              if(form){const submit=form.querySelector('button[type=submit]');if(submit&&!submit.disabled){submit.click();return 'sent-by-button';}}
              box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',which:13,keyCode:13,bubbles:true}));
              box.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',which:13,keyCode:13,bubbles:true}));
              return 'sent-by-enter';
            })()");
        }

        static async Task SetVoiceToggle(bool on, ClientWebSocket existing=null)
        {
            var target=await GetCaiTarget();
            if(target==null) { Console.WriteLine("CAI tab not found yet."); return; }
            ClientWebSocket ws=existing;
            bool owned=false;
            if(ws==null) { ws=new ClientWebSocket(); await ws.ConnectAsync(new Uri(target),CancellationToken.None); owned=true; }
            string result=await Evaluate(ws, @"(() => {
              const visible=e=>!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);
              const btns=[...document.querySelectorAll('button,[role=button]')].filter(visible);
              const matches=b=>{
                const s=b.querySelector('svg');
                if(!s)return false;
                const html=s.outerHTML.toLowerCase();
                const label=((b.getAttribute('aria-label')||'')+' '+(b.getAttribute('title')||'')+' '+(b.innerText||'')).toLowerCase();
                return /wave|voice|audio|sound/.test(label) || /wave|audio|voice/.test(html) || (s.querySelectorAll('path').length>=2 && s.querySelectorAll('path').length<=8);
              };
              const candidates=btns.filter(matches);
              const b=candidates.find(x=>/voice|audio|wave/i.test((x.getAttribute('aria-label')||'')+' '+(x.title||'')))||candidates[candidates.length-1];
              if(!b)return 'toggle-not-found';
              const label=((b.getAttribute('aria-label')||'')+' '+(b.title||'')).toLowerCase();
              const active=b.getAttribute('aria-pressed')==='true'||b.dataset.state==='on'||/turn voice off|disable voice|voice on/i.test(label);
              const desired=__DESIRED__;
              if(active===desired)return 'already-'+(desired?'on':'off');
              b.click(); return 'toggled-'+(desired?'on':'off')+':'+label.slice(0,50);
            })()".Replace("__DESIRED__",on?"true":"false"));
            Console.WriteLine(DateTime.Now.ToString("HH:mm:ss")+" "+result);
            if(result.StartsWith("toggled")||result.StartsWith("already")) voiceEnabled=on;
            if(owned) await ws.CloseAsync(WebSocketCloseStatus.NormalClosure,"done",CancellationToken.None);
        }

        static async Task EnsureDebugChrome()
        {
            if(await DebugEndpointReady()) { await NavigateCai(); return; }
            string chrome=FindChrome();
            if(chrome==null) throw new FileNotFoundException("Chrome.exe not found.");
            string profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CAI-AudioClicker-Chrome");
            Directory.CreateDirectory(profile);
            Process.Start(new ProcessStartInfo(chrome){UseShellExecute=false,Arguments="--remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="+Quote(profile)+" --no-first-run --no-default-browser-check "+Quote(CaiUrl)});
            for(int i=0;i<40;i++){if(await DebugEndpointReady()){await NavigateCai();return;}await Task.Delay(500);}
            throw new TimeoutException("Chrome debug port 9222 failed to start.");
        }
        static async Task NavigateCai()
        {
            try { using var d=JsonDocument.Parse(await Http.GetStringAsync(DebugAddress+"/json")); foreach(var x in d.RootElement.EnumerateArray()){var u=x.GetProperty("url").GetString()??"";if(u.Contains("character.ai",StringComparison.OrdinalIgnoreCase))return;} }
            catch{}
            try { await Http.GetStringAsync(DebugAddress+"/json/new?"+Uri.EscapeDataString(CaiUrl)); } catch{}
        }
        static string FindChrome(){string[] ps={Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Google","Chrome","Application","chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google","Chrome","Application","chrome.exe")};foreach(var p in ps)if(File.Exists(p))return p;return null;}
        static string Quote(string s)=>"\""+s.Replace("\"","\\\"")+"\"";
        static async Task<bool> DebugEndpointReady(){try{using var r=await Http.GetAsync(DebugAddress+"/json/version");return r.IsSuccessStatusCode;}catch{return false;}}
        static async Task<string> GetCaiTarget(){try{using var d=JsonDocument.Parse(await Http.GetStringAsync(DebugAddress+"/json"));foreach(var x in d.RootElement.EnumerateArray()){string u=x.TryGetProperty("url",out var a)?a.GetString()??"":"";string w=x.TryGetProperty("webSocketDebuggerUrl",out var b)?b.GetString()??"":"";if(u.Contains("character.ai",StringComparison.OrdinalIgnoreCase)&&w.Length>0)return w;}}catch{}return null;}
        static async Task<string> Evaluate(ClientWebSocket ws,string expression){int id=Interlocked.Increment(ref commandId);string p=JsonSerializer.Serialize(new{id,method="Runtime.evaluate",@params=new{expression,returnByValue=true}});await ws.SendAsync(Encoding.UTF8.GetBytes(p),WebSocketMessageType.Text,true,CancellationToken.None);var buf=new byte[8192];while(true){using var ms=new MemoryStream();WebSocketReceiveResult r;do{r=await ws.ReceiveAsync(buf,CancellationToken.None);ms.Write(buf,0,r.Count);}while(!r.EndOfMessage);using var j=JsonDocument.Parse(ms.ToArray());var root=j.RootElement;if(!root.TryGetProperty("id",out var rid)||rid.GetInt32()!=id)continue;if(root.TryGetProperty("result",out var res)&&res.TryGetProperty("result",out var val)&&val.TryGetProperty("value",out var v))return v.GetString()??"";return "no-value";}}
    }

    // Windows microphone RMS + speech/silence hysteresis. No Python or external model.
    internal sealed class MicrophoneMonitor : IDisposable
    {
        public event Func<Task> SpeechStarted;
        public event Action SpeechEnded;
        readonly object gate=new object();
        System.Threading.Tasks.Task loop;
        volatile bool running;
        public void Start(){running=true;loop=System.Threading.Tasks.Task.Run(CaptureLoop);}
        async Task CaptureLoop(){
            // WASAPI loopback is not used: capture the default microphone through winmm waveIn.
            var cap=new WaveInCapture();
            cap.Data+=bytes=>{
                double sum=0;for(int i=0;i+1<bytes.Length;i+=2){short v=BitConverter.ToInt16(bytes,i);sum+=(double)v*v;}
                double rms=Math.Sqrt(sum/Math.Max(1,bytes.Length/2))/32768.0;
                if(rms>0.018){quiet=0;if(!speaking){speaking=true;var h=SpeechStarted;if(h!=null)_=h();}}
                else if(speaking){quiet++;if(quiet>=18){speaking=false;quiet=0;SpeechEnded?.Invoke();}}
            };
            cap.Start();
            while(running)await Task.Delay(100);
            cap.Dispose();
        }
        int quiet;bool speaking;
        public void Dispose(){running=false;}
    }

    // Minimal WinMM waveIn PCM16 microphone capture.
    internal sealed class WaveInCapture : IDisposable
    {
        public event Action<byte[]> Data;
        IntPtr handle;bool active;readonly IntPtr[] headers=new IntPtr[4];readonly IntPtr[] buffers=new IntPtr[4];
        const int CALLBACK_FUNCTION=0x30000,WIM_DATA=0x3C0;
        delegate void WaveCallback(IntPtr h,uint msg,IntPtr instance,IntPtr param1,IntPtr param2);
        WaveCallback callback;
        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
        struct WAVEFORMATEX{public ushort tag,channels;public uint samples,avg;public ushort align,bits,extra;}
        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
        struct WAVEHDR{public IntPtr data;public uint length,recorded;public IntPtr user;public uint flags,loops;public IntPtr next;public IntPtr reserved;}
        [System.Runtime.InteropServices.DllImport("winmm.dll")]static extern int waveInOpen(out IntPtr h,uint dev,ref WAVEFORMATEX fmt,WaveCallback cb,IntPtr inst,uint flags);
        [System.Runtime.InteropServices.DllImport("winmm.dll")]static extern int waveInPrepareHeader(IntPtr h,IntPtr hdr,uint size);
        [System.Runtime.InteropServices.DllImport("winmm.dll")]static extern int waveInAddBuffer(IntPtr h,IntPtr hdr,uint size);
        [System.Runtime.InteropServices.DllImport("winmm.dll")]static extern int waveInStart(IntPtr h);
        [System.Runtime.InteropServices.DllImport("winmm.dll")]static extern int waveInStop(IntPtr h);
        [System.Runtime.InteropServices.DllImport("winmm.dll")]static extern int waveInReset(IntPtr h);
        [System.Runtime.InteropServices.DllImport("winmm.dll")]static extern int waveInUnprepareHeader(IntPtr h,IntPtr hdr,uint size);
        [System.Runtime.InteropServices.DllImport("winmm.dll")]static extern int waveInClose(IntPtr h);
        public void Start(){callback=OnWave;var f=new WAVEFORMATEX{tag=1,channels=1,samples=16000,bits=16,align=2,avg=32000};if(waveInOpen(out handle,0xffffffff,ref f,callback,IntPtr.Zero,CALLBACK_FUNCTION)!=0)throw new Exception("Could not open default microphone. Check Windows microphone permissions.");for(int i=0;i<4;i++){buffers[i]=System.Runtime.InteropServices.Marshal.AllocHGlobal(4096);headers[i]=System.Runtime.InteropServices.Marshal.AllocHGlobal(System.Runtime.InteropServices.Marshal.SizeOf<WAVEHDR>());var h=new WAVEHDR{data=buffers[i],length=4096};System.Runtime.InteropServices.Marshal.StructureToPtr(h,headers[i],false);waveInPrepareHeader(handle,headers[i],(uint)System.Runtime.InteropServices.Marshal.SizeOf<WAVEHDR>());waveInAddBuffer(handle,headers[i],(uint)System.Runtime.InteropServices.Marshal.SizeOf<WAVEHDR>());}active=true;waveInStart(handle);}
        void OnWave(IntPtr h,uint msg,IntPtr inst,IntPtr p1,IntPtr p2){if(msg!=WIM_DATA||!active)return;var hdr=System.Runtime.InteropServices.Marshal.PtrToStructure<WAVEHDR>(p1);if(hdr.recorded>0){var b=new byte[hdr.recorded];System.Runtime.InteropServices.Marshal.Copy(hdr.data,b,0,b.Length);Data?.Invoke(b);}hdr.recorded=0;hdr.flags=0;System.Runtime.InteropServices.Marshal.StructureToPtr(hdr,p1,false);waveInAddBuffer(handle,p1,(uint)System.Runtime.InteropServices.Marshal.SizeOf<WAVEHDR>());}
        public void Dispose(){active=false;if(handle!=IntPtr.Zero){waveInStop(handle);waveInReset(handle);for(int i=0;i<4;i++){if(headers[i]!=IntPtr.Zero)waveInUnprepareHeader(handle,headers[i],(uint)System.Runtime.InteropServices.Marshal.SizeOf<WAVEHDR>());if(buffers[i]!=IntPtr.Zero)System.Runtime.InteropServices.Marshal.FreeHGlobal(buffers[i]);if(headers[i]!=IntPtr.Zero)System.Runtime.InteropServices.Marshal.FreeHGlobal(headers[i]);}waveInClose(handle);}}
    }
}