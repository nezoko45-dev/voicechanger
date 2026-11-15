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
 readonly HttpListener listener=new();
 readonly TextBox output=new(){Multiline=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill};
 readonly CheckBox send=new(){Text="Send recognized final phrases to c.ai",Checked=true,AutoSize=true};
 readonly CheckBox keepalive=new(){Text="Toggle Voice every 5 seconds while IDLE",AutoSize=true};
 readonly TextBox voiceName=new(){Text="Voice",Width=100}; readonly Label status=new(){AutoSize=true,Text="Starting…"};
 DateTime lastSpeech=DateTime.UtcNow; bool disposed,waitingReply,sawGenerating,isIdle=true; int generationPolls;
 public MainForm(){
  Text="Chrome c.ai Voice Bridge";Width=760;Height=520;
  var bar=new FlowLayoutPanel{Dock=DockStyle.Top,Height=100};
  var open=new Button{Text="Open Chrome recognition",AutoSize=true};open.Click+=(s,e)=>Process.Start(new ProcessStartInfo("http://127.0.0.1:8765/"){UseShellExecute=true});
  bar.Controls.Add(open);bar.Controls.Add(send);bar.Controls.Add(keepalive);bar.Controls.Add(new Label{Text="Voice button label",AutoSize=true});bar.Controls.Add(voiceName);bar.Controls.Add(status);Controls.Add(output);Controls.Add(bar);
  Shown+=(s,e)=>{try{listener.Prefixes.Add("http://127.0.0.1:8765/");listener.Start();status.Text="localhost:8765 ready";_=Serve();}catch(Exception ex){Log("Listener failed: "+ex.Message);}};
  var timer=new System.Windows.Forms.Timer{Interval=5000};timer.Tick+=(s,e)=>{if(keepalive.Checked&&isIdle)VoiceToggle();};timer.Start();
  var monitor=new System.Windows.Forms.Timer{Interval=1000};monitor.Tick+=(s,e)=>CheckGeneration();monitor.Start();
  FormClosing+=(s,e)=>{disposed=true;try{listener.Stop();}catch{}};
 }
 void Log(string m){if(disposed)return;BeginInvoke(new Action(()=>output.AppendText(DateTime.Now.ToString("HH:mm:ss")+" "+m+Environment.NewLine)));}
 async Task Serve(){while(!disposed){HttpListenerContext c;try{c=await listener.GetContextAsync();}catch{return;} _=Task.Run(async()=>{
  try{c.Response.Headers["Access-Control-Allow-Origin"]="*";c.Response.Headers["Access-Control-Allow-Methods"]="POST,GET,OPTIONS";c.Response.Headers["Access-Control-Allow-Headers"]="Content-Type";
   if(c.Request.HttpMethod=="OPTIONS"){c.Response.StatusCode=204;c.Response.Close();return;}
   if(c.Request.Url?.AbsolutePath=="/transcript"&&c.Request.HttpMethod=="POST"){using var sr=new StreamReader(c.Request.InputStream);var j=JsonDocument.Parse(await sr.ReadToEndAsync());var phrase=j.RootElement.GetProperty("text").GetString()??"";if(!string.IsNullOrWhiteSpace(phrase)){lastSpeech=DateTime.UtcNow;isIdle=false;waitingReply=true;sawGenerating=false;generationPolls=0;Log("Transcript: "+phrase);if(send.Checked)SendToCai(phrase);}Reply(c,"{\"ok\":true}","application/json");return;}
   if(c.Request.Url?.AbsolutePath=="/"){var path=Path.Combine(AppContext.BaseDirectory,"www","index.html");if(!File.Exists(path))path=Path.Combine(AppContext.BaseDirectory,"index.html");Reply(c,File.ReadAllText(path),"text/html; charset=utf-8");return;}
   c.Response.StatusCode=404;c.Response.Close();
  }catch(Exception ex){Log("HTTP error: "+ex.Message);try{c.Response.Close();}catch{}}
 });}}
 static void Reply(HttpListenerContext c,string text,string type){var b=Encoding.UTF8.GetBytes(text);c.Response.ContentType=type;c.Response.OutputStream.Write(b);c.Response.Close();}
 void SendToCai(string phrase){try{
  // Background UIA: find c.ai's editable composer without requiring it to be focused.
  var root=AutomationElement.RootElement;
  var edits=root.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit));
  AutomationElement composer=null;
  for(int i=0;i<edits.Count;i++){
   var candidate=edits[i];
   string name="";try{name=candidate.Current.Name??"";}catch{}
   if(name.Contains("message",StringComparison.OrdinalIgnoreCase)||name.Contains("chat",StringComparison.OrdinalIgnoreCase)||name.Contains("reply",StringComparison.OrdinalIgnoreCase)){composer=candidate;break;}
  }
  if(composer==null&&edits.Count>0)composer=edits[edits.Count-1];
  if(composer==null){Log("Background c.ai composer not exposed by UI Automation; keep c.ai open in Chrome.");waitingReply=false;isIdle=true;return;}
  if(!composer.TryGetCurrentPattern(ValuePattern.Pattern,out var vp)){Log("c.ai composer lacks background ValuePattern; cannot type without focus.");waitingReply=false;isIdle=true;return;}
  ((ValuePattern)vp).SetValue(phrase);
  // Invoke Send button in the same Chrome accessibility tree; no foreground focus change.
  var sendButton=root.FindFirst(TreeScope.Descendants,new AndCondition(
   new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button),
   new PropertyCondition(AutomationElement.NameProperty,"Send")));
  if(sendButton!=null&&sendButton.TryGetCurrentPattern(InvokePattern.Pattern,out var sp))((InvokePattern)sp).Invoke();
  else {Log("Text inserted in background composer, but Send button UIA wasn't found.");}
  Log("Background c.ai message submitted; waiting for generation…");
 }catch(Exception ex){Log("Background UIA send error: "+ex.Message);waitingReply=false;isIdle=true;}}
 bool HasButton(string name){try{return AutomationElement.RootElement.FindFirst(TreeScope.Descendants,new PropertyCondition(AutomationElement.NameProperty,name))!=null;}catch{return false;}}
 void CheckGeneration(){
  if(!waitingReply)return;
  generationPolls++;
  bool generating=HasButton("Stop generating")||HasButton("Stop response")||HasButton("Stop");
  bool finishedSignal=HasButton("Regenerate")||HasButton("Try again");
  if(generating){sawGenerating=true;return;}
  if((sawGenerating&&generationPolls>=2)||finishedSignal||generationPolls>=90){
   waitingReply=false;isIdle=true;status.Text="IDLE — reply complete";Log("c.ai finished generating; bridge is IDLE.");}
 }
 // Specifically target the Character.AI toolbar's Voice button (icon + "Voice" label),
 // not an arbitrary element elsewhere with the same accessible name.
 void VoiceToggle(){try{
  var root=AutomationElement.RootElement;
  var condition=new AndCondition(
   new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button),
   new PropertyCondition(AutomationElement.NameProperty,voiceName.Text.Trim()));
  var button=root.FindFirst(TreeScope.Descendants,condition);
  if(button==null){Log("c.ai Voice BUTTON not found (accessible name: "+voiceName.Text+").");return;}
  if(button.TryGetCurrentPattern(InvokePattern.Pattern,out var p)){((InvokePattern)p).Invoke();Log("Character.AI Voice button toggled.");}
  else {Log("Character.AI Voice button found, but UI Automation cannot invoke it.");}
 }catch(Exception ex){Log("Voice button toggle error: "+ex.Message);}}
}