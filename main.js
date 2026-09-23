const {app,BrowserWindow,session}=require("electron");
const path=require("path");

app.commandLine.appendSwitch("autoplay-policy","no-user-gesture-required");
app.commandLine.appendSwitch("enable-features","WebContentsAudioFocus");

function createWindow(){
  const win=new BrowserWindow({
    width:900,height:900,minWidth:700,minHeight:700,
    backgroundColor:"#070a10",
    webPreferences:{
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname,"index.html"));
}

app.whenReady().then(async()=>{
  session.defaultSession.setPermissionRequestHandler((_wc,permission,callback)=>{
    callback(permission==="media"||permission==="audioCapture"||permission==="audioInput");
  });
  session.defaultSession.setPermissionCheckHandler((_wc,permission)=>{
    return permission==="media"||permission==="audioCapture"||permission==="audioInput";
  });
  createWindow();
  app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()});
});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit()});
