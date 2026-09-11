@echo off
setlocal
cd /d "%~dp0web"
where py >nul 2>nul
if %errorlevel%==0 (set PY=py) else (set PY=python)
%PY% --version
if errorlevel 1 (
  echo Python was not found. Install Python 3.12 and try again.
  pause
  exit /b 1
)
echo.
echo Installing/updating VoiceChanger dependencies...
%PY% -m pip install -r requirements-local.txt
if errorlevel 1 (
  echo Dependency installation failed.
  pause
  exit /b 1
)
echo.
echo Starting VoiceChanger Python server...
start "VoiceChanger Python Server" /min "%PY%" local_server.py

echo Waiting for the local server...
timeout /t 4 /nobreak >nul
start "" "http://127.0.0.1:8765/"
echo VoiceChanger is opening in your browser.
echo Python is running in the background.
exit /b 0
