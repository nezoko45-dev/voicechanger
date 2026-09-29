@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
 echo.
 echo Node.js 18+ is required.
 echo Install Node.js LTS, then run this file again.
 echo.
 pause
 exit /b 1
)

echo.
echo Starting Deepgram + PocketTTS Chrome Voice Changer...
echo.

start "Deepgram PocketTTS Server" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul

start "" "chrome.exe" "http://127.0.0.1:8787/"
if errorlevel 1 start "" "http://127.0.0.1:8787/"

echo Chrome app opened.
echo Close the server window when you are finished.
