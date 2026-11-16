using System.Net;
using System.Text;
using System.Text.Json;
using System.Windows.Automation;
using System.Runtime.InteropServices;
using System.Windows.Forms;

ApplicationConfiguration.Initialize();
Application.Run(new BridgeForm());

sealed class BridgeForm : Form {
 const string Origin="https://nezoko45-dev.github.io";
 HttpListener listener=new(); CancellationTokenSource stop=new();
 TextBox log=new(){Multiline=true,Dock=DockStyle.Fill,ReadOnly=true,ScrollBars=ScrollBars.Vertical};
 public BridgeForm(){Text="Character.AI Speech Bridge";Width=520;Height=360;Controls.Add(log);Shown+=async(_,_)=>{listener.Prefixes.Add("http://127.0.0.1:8788/");try{listener.Start();Write("Listening on http://127.0.0.1:8788");while(!stop.IsCancellationRequested){var c=await listener.GetContextAsync();_=Task.Run(()=>Handle(c));}}catch(Exception e){Write(e.Message);}};FormClosing+=(_,_)=>{stop.Cancel();listener.Close();};}
 void Write(string s){if(IsDisposed)return;BeginInvoke(()=>log.AppendText(DateTime.Now.ToString("HH:mm:ss ")+s+Environment.NewLine));}
 async Task Handle(HttpListenerContext c){var r=c.Response; r.Headers["Access-Control-Allow-Origin"]=Origin;r.Headers["Vary"]="Origin";r.Headers["Access-Control-Allow-Methods"]="GET, POST, OPTIONS";r.Headers["Access-Control-Allow-Headers"]="Content-Type";r.Headers["Access-Control-Allow-Private-Network"]="true";
 try{if(c.Request.HttpMethod=="OPTIONS"){r.StatusCode=204;return;}object data;
 string path=c.Request.Url?.AbsolutePath??"/";
 if(path=="/status")data=new{ok=true,message="CAI-Bridge ready"};
 else if(path=="/voice/on"){bool clicked=ToggleVoice();data=new{ok=clicked,error=clicked?null:"Voice button not found in Chrome UI Automation tree",result=clicked?"Voice toggle clicked":"VOICE_UIA_NOT_FOUND"};}
 else if(path=="/transcript"){using var sr=new StreamReader(c.Request.InputStream);var j=JsonDocument.Parse(await sr.ReadToEndAsync());string text=j.RootElement.GetProperty("text").GetString()??"";PasteAndEnter(text);Write("Transcript sent: "+text);data=new{ok=true,result="ENTER_SENT"};}
 else{r.StatusCode=404;data=new{ok=false,error="Not found"};}
 r.ContentType="application/json";byte[] b=Encoding.UTF8.GetBytes(JsonSerializer.Serialize(data));r.ContentLength64=b.Length;await r.OutputStream.WriteAsync(b);
 }catch(Exception e){r.StatusCode=500;byte[] b=Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{ok=false,error=e.Message}));r.ContentLength64=b.Length;await r.OutputStream.WriteAsync(b);}finally{r.Close();}}
 static void PasteAndEnter(string text){var chrome=FindChrome();if(chrome==IntPtr.Zero)throw new Exception("Chrome window not found");SetForegroundWindow(chrome);Clipboard.SetText(text);SendKeys.SendWait("^v");SendKeys.SendWait("{ENTER}");}
 static bool ToggleVoice(){var w=FindChrome();if(w==IntPtr.Zero)return false;try{var root=AutomationElement.FromHandle(w);var buttons=root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button));foreach(AutomationElement b in buttons){string name=b.Current.Name??"";if(name.Contains("voice",StringComparison.OrdinalIgnoreCase)||name.Contains("start voice",StringComparison.OrdinalIgnoreCase)){if(b.TryGetCurrentPattern(InvokePattern.Pattern,out object p)){((InvokePattern)p).Invoke();return true;}}}}catch{}return false;}
 static IntPtr FindChrome(){IntPtr found=IntPtr.Zero;EnumWindows((h,_)=>{if(IsWindowVisible(h)){var s=new StringBuilder(512);GetWindowText(h,s,s.Capacity);if(s.ToString().Contains("Character.AI",StringComparison.OrdinalIgnoreCase)||s.ToString().Contains("c.ai",StringComparison.OrdinalIgnoreCase)){found=h;return false;}}return true;},IntPtr.Zero);return found;}
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc cb,IntPtr p);delegate bool EnumProc(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
}