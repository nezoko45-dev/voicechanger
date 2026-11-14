using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Windows.Automation;

namespace ChromeCaiBridge;
public sealed class MainForm : Form {
 readonly HttpListener listener=new(); readonly TextBox output=new(){Multiline=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill};
 readonly CheckBox send=new(){Text="Send recognized final phrases to focused c.ai input",Checked=true,AutoSize=true};
 readonly CheckBox keepalive=new(){Text="Experimental idle Voice toggle every 5 seconds",AutoSize=true};
 readonly TextBox voiceName=new(){Text="Voice",Width=120}; readonly Label status=new(){AutoSize=true,Text="Starting…"};
 DateTime lastSpeech=DateTime.UtcNow; bool disposed;
 public MainForm(){
  Text="Chrome c.ai Voice Bridge";Width=720;Height=500;
  var bar=new FlowLayoutPanel{Dock=DockStyle.Top,Height=95};
  var open=new Button{Text="Open Chrome recognition",AutoSize=true};open.Click+=(s,e)=>Process.Start(new ProcessStartInfo("http://127.0.0.1:8765/"){UseShellExecute=true});
  bar.Controls.Add(open);bar.Controls.Add(send);bar.Controls.Add(keepalive);bar.Controls.Add(new Label{Text="Voice control name",AutoSize=true});bar.Controls.Add(voiceName);bar.Controls.Add(status);Controls.Add(output);Controls.Add(bar);
  Shown+=(s,e)=>{try{listener.Prefixes.Add("http://127.0.0.1:8765/");listener.Start();status.Text="localhost:8765 ready";_=Serve();}catch(Exception ex){Log("Listener failed: "+ex.Message);}};
  var timer=new Timer{Interval=5000};timer.Tick+=(s,e)=>{if(keepalive.Checked&&(DateTime.UtcNow-lastSpeech).TotalSeconds>=5)VoiceToggle();};timer.Start();
  FormClosing+=(s,e)=>{disposed=true;try{listener.Stop();}catch{}};
 }
 void Log(string m){if(disposed)return;BeginInvoke(()=>output.AppendText(DateTime.Now.ToString("HH:mm:ss")+" "+m+Environment.NewLine));}
 async Task Serve(){while(!disposed){HttpListenerContext c;try{c=await listener.GetContextAsync();}catch{return;} _=Task.Run(async()=>{
  try{c.Response.Headers["Access-Control-Allow-Origin"]="*";c.Response.Headers["Access-Control-Allow-Methods"]="POST,GET,OPTIONS";c.Response.Headers["Access-Control-Allow-Headers"]="Content-Type";
   if(c.Request.HttpMethod=="OPTIONS"){c.Response.StatusCode=204;c.Response.Close();return;}
   if(c.Request.Url?.AbsolutePath=="/transcript"&&c.Request.HttpMethod=="POST"){using var sr=new StreamReader(c.Request.InputStream);var j=JsonDocument.Parse(await sr.ReadToEndAsync());var phrase=j.RootElement.GetProperty("text").GetString()??"";if(!string.IsNullOrWhiteSpace(phrase)){lastSpeech=DateTime.UtcNow;Log("Transcript: "+phrase);if(send.Checked)SendToFocusedCai(phrase);}Reply(c,"{\"ok\":true}","application/json");return;}
   if(c.Request.Url?.AbsolutePath=="/"){var path=Path.Combine(AppContext.BaseDirectory,"www","index.html");if(!File.Exists(path))path=Path.Combine(AppContext.BaseDirectory,"index.html");Reply(c,File.ReadAllText(path),"text/html; charset=utf-8");return;}
   c.Response.StatusCode=404;c.Response.Close();
  }catch(Exception ex){Log("HTTP error: "+ex.Message);try{c.Response.Close();}catch{}}
 });}}
 static void Reply(HttpListenerContext c,string text,string type){var b=Encoding.UTF8.GetBytes(text);c.Response.ContentType=type;c.Response.OutputStream.Write(b);c.Response.Close();}
 void SendToFocusedCai(string phrase){try{
  var el=AutomationElement.FocusedElement;if(el==null){Log("Click c.ai's message field first; transcript queued nowhere.");return;}
  while(el!=null&&el.Current.ControlType!=ControlType.Edit)el=TreeWalker.ControlViewWalker.GetParent(el);
  if(el==null){Log("Focused element isn't an editable c.ai input; click its textbox.");return;}
  el.SetFocus();
  if(el.TryGetCurrentPattern(ValuePattern.Pattern,out var vp)){((ValuePattern)vp).SetValue(phrase);}
  else {Clipboard.SetText(phrase);SendKeys.SendWait("^v");}
  SendKeys.SendWait("{ENTER}");Log("Submitted to c.ai.");
 }catch(Exception ex){Log("UIA send error: "+ex.Message);}}
 void VoiceToggle(){try{var root=AutomationElement.RootElement;var e=root.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.NameProperty,voiceName.Text));if(e==null){Log("Voice UIA name not found: "+voiceName.Text);return;}if(e.TryGetCurrentPattern(InvokePattern.Pattern,out var p)){((InvokePattern)p).Invoke();Log("Voice control invoked.");}else Log("Voice control has no InvokePattern.");}catch(Exception ex){Log("Voice toggle error: "+ex.Message);}}
}