const { app, BrowserWindow, session } = require("electron");

// Keep the renderer on the stable CPU audio/inference path. WebGPU crashes can
// take down the whole Electron renderer on some Windows GPU/driver combinations.
app.disableHardwareAcceleration();
const path = require("node:path");

app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function createWindow() {
  const win = new BrowserWindow({
    width: 920,
    height: 900,
    minWidth: 760,
    minHeight: 700,
    backgroundColor: "#0d1117",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Renderer exited: ${details.reason} (exitCode ${details.exitCode ?? "n/a"})`);
  });

  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "index.html")).catch((err) => {
    console.error("Failed to load VoiceChanger UI:", err);
  });
}

process.on("uncaughtException", (err) => console.error("Electron main-process error:", err));
process.on("unhandledRejection", (err) => console.error("Electron promise error:", err));

app.on("child-process-gone", (_event, details) => {
  console.error(`Electron child process exited: ${details.type} / ${details.name ?? "unknown"} / ${details.reason}`);
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "media");
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "media";
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
