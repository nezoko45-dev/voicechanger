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

echo Starting local PocketTTS voice app...
start "" "chrome.exe" "http://127.0.0.1:8787/"
if errorlevel 1 (
 echo Chrome was not found on PATH. Opening the local app with the default browser instead.
 start "" "http://127.0.0.1:8787/"
)

node server.js
pause
