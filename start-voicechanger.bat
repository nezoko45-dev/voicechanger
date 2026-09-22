@echo off
setlocal
cd /d "%~dp0"
title VoiceChanger - Electron OpenVoice V2

echo ==========================================
echo VOICECHANGER - ELECTRON OPENVOICE V2
echo ==========================================
echo.
echo UI:      HTML / JavaScript / Electron
echo Engine:  OpenVoice V2 FP32 ONNX Runtime
echo Audio:   Electron microphone -> OpenVoice -> Voicemeeter
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js 20+ is required.
  echo.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

if not exist "electron-main.js" (
  echo ERROR: electron-main.js is missing.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is not installed yet.
  echo Installing the Electron runtime...
  echo This is a one-time download.
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: Electron installation failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting the Electron voice changer...
call npm start
