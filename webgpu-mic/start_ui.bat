@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher was not found. Install Python 3.10+ and enable "Add Python to PATH".
  pause
  exit /b 1
)
echo Opening the local VoiceClonNX microphone page...
start "" "http://127.0.0.1:8000/index.html"
py -3 -m http.server 8000 --bind 127.0.0.1
pause
