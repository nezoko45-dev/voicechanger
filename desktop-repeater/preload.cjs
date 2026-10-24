const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("desktopInfo", { platform: process.platform, name: "Kokoro Voice Repeater" });
