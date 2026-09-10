@echo off
setlocal
cd /d "%~dp0"
py -3 -m pip install --upgrade pip
py -3 -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo Failed to install the native audio bridge requirements.
  pause
  exit /b 1
)
echo.
echo Native VoiceChanger audio bridge installed successfully.
pause
