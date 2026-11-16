using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Windows.Forms;

ApplicationConfiguration.Initialize();
Application.Run(new BridgeForm());

sealed class BridgeForm : Form {
 const string Origin="https://nezoko45-dev.github.io";
 const string ControlsUrl="https://nezoko45-dev.github.io/voicechanger/c-ai-pages/";
 HttpListener listener=new(); CancellationTokenSource stop=new();
 TextBox log=new(){Multiline=true,Dock=DockStyle.Fill,ReadOnly=true,ScrollBars=ScrollBars.Vertical};
 public BridgeForm(){Text="Character.AI Speech Bridge";Width=520;Height=360;Controls.Add(log);Shown+=async(_,_)=>{try{await EnsureDebugChrome();listener.Prefixes.Add("http://127.0.0.1:8788/");listener.Start();Write("Bridge online at 127.0.0.1:8788 — Chrome debug connected.");while(!stop.IsCancellationRequested){var c=await listener.GetContextAsync();_=Task.Run(()=>Handle(c));}}catch(Exception e){Write("STARTUP ERROR: "+e.Message);}};FormClosing+=(_,_)=>{stop.Cancel();listener.Close();};}
 async Task EnsureDebugChrome(){using var http=new HttpClient();try{using var r=await http.GetAsync("http://127.0.0.1:9222/json/version");if(r.IsSuccessStatusCode){Write("Chrome debugging port 9222 already active.");await EnsureControlPage(http);return;}}catch{} string? chrome=FindChromePath();if(chrome==null)throw new Exception("Chrome executable not found.");string profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CAISpeechBridge","ChromeDebugProfile");Directory.CreateDirectory(profile);Process.Start(new ProcessStartInfo(chrome){UseShellExecute=false,Arguments="--remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=\""+profile+"\" --no-first-run --new-window https://character.ai https://nezoko45-dev.github.io/voicechanger/c-ai-pages/"});Write("Opened dedicated Chrome debug window. Sign into Character.AI there.");for(int i=0;i<40;i++){try{using var r=await http.GetAsync("http://127.0.0.1:9222/json/version");if(r.IsSuccessStatusCode){await EnsureControlPage(http);return;}}catch{}await Task.Delay(500);}throw new Exception("Chrome debug startup timed out.");}
 async Task EnsureControlPage(HttpClient http){using var tabs=JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json/list"));foreach(var t in tabs.RootElement.EnumerateArray()){if(t.TryGetProperty("url",out var u)&&u.GetString()?.StartsWith(ControlsUrl,StringComparison.OrdinalIgnoreCase)==true){Write("GitHub Pages controls already open in debug Chrome.");return;}}using var opened=await http.PutAsync("http://127.0.0.1:9222/json/new?"+Uri.EscapeDataString(ControlsUrl),new StringContent(""));if(!opened.IsSuccessStatusCode)throw new Exception("Could not open GitHub Pages inside debug Chrome: "+opened.StatusCode);Write("Opened GitHub Pages controls in the SAME debug Chrome. Enable mic permission there.");}
 void Write(string s){if(IsDisposed)return;BeginInvoke(()=>log.AppendText(DateTime.Now.ToString("HH:mm:ss ")+s+Environment.NewLine));}
 async Task Handle(HttpListenerContext c){var r=c.Response;r.Headers["Access-Control-Allow-Origin"]=Origin;r.Headers["Vary"]="Origin";r.Headers["Access-Control-Allow-Methods"]="GET, POST, OPTIONS";r.Headers["Access-Control-Allow-Headers"]="Content-Type";r.Headers["Access-Control-Allow-Private-Network"]="true";
 try{if(c.Request.HttpMethod=="OPTIONS"){r.StatusCode=204;return;}object data;string path=c.Request.Url?.AbsolutePath??"/";
 if(path=="/status")data=new{ok=true,message="CAI-Bridge ready"};
 else if(path=="/voice/on"||path=="/voice/toggle"){string result=await ToggleVoiceCDP();bool ok=result.StartsWith("CLICKED");data=new{ok,error=ok?null:result,result};Write("Voice: "+result);}
 else if(path=="/transcript"){using var sr=new StreamReader(c.Request.InputStream);var j=JsonDocument.Parse(await sr.ReadToEndAsync());string text=j.RootElement.GetProperty("text").GetString()??"";PasteAndEnter(text);Write("Transcript sent: "+text);data=new{ok=true,result="ENTER_SENT"};}
 else{r.StatusCode=404;data=new{ok=false,error="Not found"};}
 r.ContentType="application/json";byte[] b=Encoding.UTF8.GetBytes(JsonSerializer.Serialize(data));r.ContentLength64=b.Length;await r.OutputStream.WriteAsync(b);
 }catch(Exception e){r.StatusCode=500;byte[] b=Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{ok=false,error=e.Message}));r.ContentLength64=b.Length;await r.OutputStream.WriteAsync(b);}finally{r.Close();}}
 static void PasteAndEnter(string text){
 using var http=new HttpClient();using var targets=JsonDocument.Parse(http.GetStringAsync("http://127.0.0.1:9222/json/list").GetAwaiter().GetResult());
 string? targetId=null;foreach(var t in targets.RootElement.EnumerateArray()){if(t.TryGetProperty("type",out var ty)&&ty.GetString()=="page"&&t.TryGetProperty("url",out var u)&&u.GetString()?.Contains("character.ai",StringComparison.OrdinalIgnoreCase)==true){targetId=t.GetProperty("id").GetString();break;}}
 if(targetId==null)throw new Exception("No Character.AI tab in debug Chrome. Launch CAI-Bridge Chrome first.");
 http.PutAsync("http://127.0.0.1:9222/json/activate/"+targetId,new StringContent("")).GetAwaiter().GetResult();
 var chrome=FindChrome();if(chrome==IntPtr.Zero)throw new Exception("Debug Chrome window not found");SetForegroundWindow(chrome);Clipboard.SetText(text);SendKeys.SendWait("^v");SendKeys.SendWait("{ENTER}");
 }
 static async Task<string> ToggleVoiceCDP(){using var http=new HttpClient();var targets=JsonDocument.Parse(await http.GetStringAsync("http://127.0.0.1:9222/json/list"));string? wsUrl=null;foreach(var t in targets.RootElement.EnumerateArray()){if(t.TryGetProperty("type",out var type)&&type.GetString()=="page"&&t.TryGetProperty("url",out var u)&&u.GetString()?.Contains("character.ai",StringComparison.OrdinalIgnoreCase)==true){wsUrl=t.GetProperty("webSocketDebuggerUrl").GetString();break;}}if(wsUrl==null)return "NO_CAI_CHROME_DEBUG_TARGET (launch Chrome with --remote-debugging-port=9222)";
 using var ws=new ClientWebSocket();await ws.ConnectAsync(new Uri(wsUrl),CancellationToken.None);string expr="(()=>{const d='M8 4v16M4 10v4m8-6v8m4-10v12m4-8v4',p=[...document.querySelectorAll('path')].find(x=>(x.getAttribute('d')||'').replace(/[\\s,]/g,'')===d.replace(/[\\s,]/g,''));if(!p)return 'SVG_PATH_NOT_FOUND';const b=p.closest('button,[role=button]');(b||p).click();return 'CLICKED waveform; button='+!!b})()";
 var msg=JsonSerializer.Serialize(new{ id=1,method="Runtime.evaluate", @params=new{expression=expr,returnByValue=true}});await ws.SendAsync(Encoding.UTF8.GetBytes(msg),WebSocketMessageType.Text,true,CancellationToken.None);byte[] buf=new byte[8192];var result=new StringBuilder();while(true){var rr=await ws.ReceiveAsync(buf,CancellationToken.None);result.Append(Encoding.UTF8.GetString(buf,0,rr.Count));if(rr.EndOfMessage)break;}using var parsed=JsonDocument.Parse(result.ToString());return parsed.RootElement.GetProperty("result").GetProperty("result").GetProperty("value").GetString()??"CDP_NO_VALUE";}
 static string? FindChromePath(){string[] paths={Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google\\Chrome\\Application\\chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Google\\Chrome\\Application\\chrome.exe"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google\\Chrome\\Application\\chrome.exe")};return paths.FirstOrDefault(File.Exists);}
 static IntPtr FindChrome(){IntPtr found=IntPtr.Zero;EnumWindows((h,_)=>{if(IsWindowVisible(h)){var s=new StringBuilder(512);GetWindowText(h,s,s.Capacity);if(s.ToString().Contains("Character.AI",StringComparison.OrdinalIgnoreCase)||s.ToString().Contains("c.ai",StringComparison.OrdinalIgnoreCase)){found=h;return false;}}return true;},IntPtr.Zero);return found;}
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc cb,IntPtr p);delegate bool EnumProc(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
}