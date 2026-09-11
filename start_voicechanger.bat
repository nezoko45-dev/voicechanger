@echo off
setlocal
cd /d "%~dp0web"

where py >nul 2>nul
if %errorlevel%==0 (set PY=py) else (set PY=python)

%PY% --version >nul 2>&1
if errorlevel 1 (
  echo Python was not found. Install Python 3.12 and run this again.
  pause
  exit /b 1
)

echo Installing local VoiceChanger packages...
%PY% -m pip install flask numpy soundfile faster-whisper qwen-tts "torch>=2.6"
if errorlevel 1 (
  echo Package installation failed.
  pause
  exit /b 1
)

echo Starting VoiceChanger Python server...
start "VoiceChanger Python Server" /min "%PY%" local_server.py

echo Waiting for the server...
timeout /t 4 /nobreak >nul
start "" "http://127.0.0.1:8765/"

echo VoiceChanger is opening in your browser.
echo You do NOT need requirements-local.txt to launch it.
exit /b 0
