const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("voiceChangerDesktop", {
  isElectron: true,
  platform: process.platform
});
