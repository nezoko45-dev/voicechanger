const {app,BrowserWindow,session}=require("electron");
const path=require("node:path");
let win=null;
function createWindow(){
 win=new BrowserWindow({show:false,width:420,height:220,backgroundColor:"#111111",webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false}});
 win.setMenuBarVisibility(false);win.loadFile(path.join(__dirname,"source.html"));win.on("closed",()=>{win=null});
}
app.whenReady().then(()=>{session.defaultSession.setPermissionRequestHandler((_wc,permission,callback)=>callback(permission==="media"));createWindow()});
app.on("window-all-closed",()=>{});
