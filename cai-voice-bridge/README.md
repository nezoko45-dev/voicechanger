# Character.AI Voice Bridge (no extension)

A small Windows companion that connects to a Chromium browser's DevTools Protocol and clicks Character.AI's Voice button every five seconds.

## First run
1. Build/publish the app (or download the workflow artifact).
2. Run `Launch-Chrome.bat`. It opens a **separate Chrome profile** with debugging enabled. Sign in to Character.AI in that profile once.
3. Run `CaiVoiceBridge.exe`.
4. Leave the Character.AI browser open. The console reports when it connects and clicks the Voice control.

## Why a separate browser profile?
Modern Chrome requires remote debugging to use a non-default profile. This avoids interfering with your normal browser profile and doesn't install an extension.

## Build
```powershell
dotnet publish CaiVoiceBridge.csproj -c Release -r win-x64 --self-contained true /p:PublishSingleFile=true
```
