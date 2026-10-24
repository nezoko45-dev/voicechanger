const { app, BrowserWindow, session } = require("electron");
const path = require("path");
app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("enable-features", "Vulkan,UseSkiaRenderer");

function createWindow() {
  const win = new BrowserWindow({
    width: 960, height: 760, minWidth: 680, minHeight: 580,
    title: "Kokoro Voice Repeater",
    backgroundColor: "#10121a",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "microphone");
  });
  win.loadFile(path.join(__dirname, "dist", "index.html"));
}
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
