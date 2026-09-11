@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (set PY=py) else (set PY=python)
%PY% --version
if errorlevel 1 (
  echo Python was not found. Install Python 3.12 and try again.
  pause
  exit /b 1
)
echo.
echo Installing/updating local VoiceChanger dependencies...
%PY% -m pip install -r requirements-local.txt
if errorlevel 1 (
  echo Dependency installation failed.
  pause
  exit /b 1
)
echo.
echo Starting local VoiceChanger server...
echo Keep this window open while using the HTML app.
%PY% local_server.py
pause
