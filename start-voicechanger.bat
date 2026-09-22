@echo off
setlocal
cd /d "%~dp0"
title VoiceChanger - Chrome OpenVoice V2

echo ==========================================
echo VOICECHANGER - CHROME OPENVOICE V2
echo ==========================================
echo.
echo UI:      Google Chrome
echo Audio:   Chrome Web Audio
echo Engine:  OpenVoice V2 FP32 ONNX Runtime WASM
echo Route:   Chrome -> Voicemeeter -> VRChat
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js 20+ is required.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

if not exist "server.mjs" (
  echo ERROR: server.mjs is missing.
  pause
  exit /b 1
)

echo Starting local VoiceChanger server...
start "VoiceChanger Server" /min cmd /c "node server.mjs"

timeout /t 2 /nobreak >nul

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not defined CHROME (
  echo ERROR: Google Chrome was not found.
  pause
  exit /b 1
)

echo Opening VoiceChanger in Chrome...
start "" "%CHROME%" --app=http://127.0.0.1:8765

echo.
echo VoiceChanger is running in Chrome.
echo Keep this window open while using the app.
echo.
pause
