@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ==========================================
echo   RVC REALTIME VOICE CHANGER SETUP
echo ==========================================
echo.
echo This installs the official RVC WebUI in:
echo   rvc-realtime
echo.
echo RVC needs a trained .pth voice model for conversion.
echo Your WAV reference can be used later to train a target voice.
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found.
  echo Install Python 3.10/3.11 and run this file again.
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo Git was not found.
  echo Install Git for Windows and run this file again.
  pause
  exit /b 1
)

if not exist "rvc-realtime\infer-web.py" (
  echo Downloading RVC...
  git clone https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI.git rvc-realtime
  if errorlevel 1 (
    echo RVC download failed.
    pause
    exit /b 1
  )
)

cd /d "%~dp0rvc-realtime"

if not exist "venv\Scripts\python.exe" (
  echo Creating RVC Python environment...
  python -m venv venv
  if errorlevel 1 goto :fail
)

echo Installing RVC dependencies...
venv\Scripts\python.exe -m pip install --upgrade pip
venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto :fail

echo.
echo RVC setup is complete.
echo Put your trained .pth model in:
echo   rvc-realtime\assets\weights
echo.
echo Then run rvc_realtime.bat.
echo.
pause
exit /b 0

:fail
cd /d "%~dp0"
echo.
echo RVC setup failed. Read the error above.
pause
exit /b 1
