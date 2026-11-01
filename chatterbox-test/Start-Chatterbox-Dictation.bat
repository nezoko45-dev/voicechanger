@echo off
setlocal EnableExtensions
title Chatterbox Voice Cloning + Continuous Dictation
cd /d "%~dp0"

set "VENV=%~dp0.venv"
set "VPY=%VENV%\Scripts\python.exe"
set "APP_URL=https://nezoko45-dev.github.io/voicechanger/chatterbox-test/"
set "PYTHON="

echo.
echo  ==================================================
echo     CHATTERBOX - VOICE CLONING + LIVE DICTATION
echo  ==================================================
echo.
echo [1/5] Checking Python 3.11...

where py >nul 2>nul
if not errorlevel 1 (
  py -3.11 --version >nul 2>nul
  if not errorlevel 1 set "PYTHON=py -3.11"
)
if not defined PYTHON (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,11) else 1)" >nul 2>nul
    if not errorlevel 1 set "PYTHON=python"
  )
)
if not defined PYTHON (
  echo [ERROR] Python 3.11 was not found.
  echo Install Python 3.11 x64 from https://www.python.org/downloads/
  echo Select "Add Python to PATH" during installation.
  pause
  exit /b 1
)
echo [OK] Python 3.11 found.

echo.
echo [2/5] Checking the isolated environment...
if not exist "%VPY%" (
  %PYTHON% -m venv "%VENV%"
  if errorlevel 1 goto :fail
)
"%VPY%" -m pip --version >nul 2>nul
if errorlevel 1 (
  "%VPY%" -m ensurepip --upgrade
  if errorlevel 1 goto :fail
)

echo.
echo [3/5] Checking Chatterbox dependencies...
"%VPY%" -c "import chatterbox, fastapi, uvicorn, multipart, torchaudio" >nul 2>nul
if errorlevel 1 (
  echo [SETUP] Installing required packages. First install may take a while...
  "%VPY%" -m pip install --upgrade pip
  if errorlevel 1 goto :fail
  "%VPY%" -m pip install -r requirements.txt
  if errorlevel 1 goto :fail
) else (
  echo [OK] Chatterbox dependencies are ready.
)

echo.
echo [4/5] Checking whether the local engine is already running...
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/status' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo [OK] Existing local Chatterbox engine detected.
) else (
  echo [START] Starting local Chatterbox engine...
  start "Chatterbox Local Engine" cmd /k ""%VPY%" "%~dp0server.py""
  echo [WAIT] Waiting for the local API to become available...
  powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 40;$i++){try{$r=Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/status' -TimeoutSec 2;$ok=$true;break}catch{Start-Sleep -Milliseconds 750}}; if($ok){exit 0}else{exit 1}"
  if errorlevel 1 (
    echo [ERROR] Local server did not start. Check the Chatterbox Local Engine window.
    pause
    exit /b 1
  )
)

echo.
echo [5/5] Opening the app with Chrome...
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if defined CHROME (
  start "" "%CHROME%" "%APP_URL%"
) else (
  echo [INFO] Chrome executable not found in standard locations. Opening default browser.
  start "" "%APP_URL%"
)

echo.
echo [READY] The app is open.
echo - Click Start continuous dictation and allow microphone access.
echo - Chrome recognition refreshes its session automatically.
echo - Upload a reference WAV and click Generate cloned voice.
echo.
echo Keep the Chatterbox Local Engine window open while generating audio.
echo Dictation uses Chrome speech recognition and requires internet access.
echo.
pause
exit /b 0

:fail
echo.
echo [ERROR] Dependency setup failed. Read the error above.
echo Send me the full error text if installation fails.
pause
exit /b 1
