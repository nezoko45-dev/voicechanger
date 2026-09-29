@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
 echo Node.js 18+ is required.
 echo Install Node.js LTS, then run this file again.
 pause
 exit /b 1
)

if not exist node_modules\speaker\package.json (
 echo Installing local audio backend...
 call npm install
 if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
 )
)

echo.
echo Starting local PocketTTS voice changer...
echo Windows audio backend will play the cloned voice directly.
echo.
start "" "chrome.exe" "http://127.0.0.1:8787/"
if errorlevel 1 start "" "http://127.0.0.1:8787/"

node server.js
pause
