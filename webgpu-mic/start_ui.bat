@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher was not found. Install Python 3.10+ and enable "Add Python to PATH".
  pause
  exit /b 1
)
echo Starting local UI server at http://127.0.0.1:8000
start "VoiceClonNX UI server" cmd /k py -3 -m http.server 8000 --bind 127.0.0.1
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8000/index.html"
echo UI server is running in its own window. Close that window to stop it.
