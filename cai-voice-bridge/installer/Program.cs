using System.Diagnostics;
using System.Text.Json;
using Microsoft.Win32;

ApplicationConfiguration.Initialize();
var f=new Form{Text="CAI Voice Bridge Setup",Width=540,Height=330,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false};
var title=new Label{Text="Install CAI Voice Bridge",Font=new System.Drawing.Font("Segoe UI",16, System.Drawing.FontStyle.Bold),Left=20,Top=18,Width=470,Height=35};
var info=new Label{Text="1) Load the included Chrome extension folder in chrome://extensions\n2) Copy its ID and paste it below.\n3) Click Install — no terminal or commands.",Left=22,Top=65,Width=480,Height=65};
var idLabel=new Label{Text="Chrome extension ID:",Left=22,Top=145,Width=140};
var idBox=new TextBox{Left=165,Top=140,Width=330};
var install=new Button{Text="Install",Left=165,Top=185,Width=150,Height=42};
var status=new Label{Text="Installer will register the host for your Windows account.",Left=22,Top=245,Width=480,Height=45};
f.Controls.AddRange([title,info,idLabel,idBox,install,status]);
install.Click+=(_,_)=>{
 var id=idBox.Text.Trim();
 if(!System.Text.RegularExpressions.Regex.IsMatch(id,"^[a-p]{32}$")){MessageBox.Show("Paste the 32-character Chrome extension ID first.");return;}
 try{
  var exe=Path.Combine(AppContext.BaseDirectory,"CaiVoiceBridge.exe");
  if(!File.Exists(exe)){MessageBox.Show("CaiVoiceBridge.exe must be in this installer's folder.");return;}
  var manifestPath=Path.Combine(AppContext.BaseDirectory,"org.cai.voicebridge.json");
  var manifest=JsonSerializer.Serialize(new{name="org.cai.voicebridge",description="CAI Voice Bridge native messaging host",path=exe,type="stdio",allowed_origins=new[]{"chrome-extension://"+id+"/"}},new JsonSerializerOptions{WriteIndented=true});
  File.WriteAllText(manifestPath,manifest);
  using var key=Registry.CurrentUser.CreateSubKey(@"Software\Google\Chrome\NativeMessagingHosts\org.cai.voicebridge");
  key!.SetValue("",manifestPath,RegistryValueKind.String);
  status.Text="Installed successfully! Open CAI Voice Bridge.exe.";
  MessageBox.Show("Native Messaging installed!","CAI Voice Bridge",MessageBoxButtons.OK,MessageBoxIcon.Information);
 }catch(Exception ex){MessageBox.Show("Install failed: "+ex.Message);}
};
Application.Run(f);