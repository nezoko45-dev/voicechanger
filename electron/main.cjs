const {app,BrowserWindow,session}=require("electron");

let win=null;

function createWindow(){
  win=new BrowserWindow({
    width:900,
    height:720,
    minWidth:760,
    minHeight:620,
    backgroundColor:"#0d1117",
    show:false,
    webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}
  });
  win.setMenuBarVisibility(false);
  session.defaultSession.setPermissionRequestHandler((_wc,permission,callback)=>{
    callback(permission==="media");
  });
  win.loadURL("http://127.0.0.1:8765/");
  win.once("ready-to-show",()=>win.show());
  win.on("closed",()=>{win=null});
}
app.whenReady().then(createWindow);
app.on("window-all-closed",()=>{});
