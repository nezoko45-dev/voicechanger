@echo off
setlocal EnableExtensions
title Chatterbox Voice Cloning Launcher
cd /d "%~dp0"

set "PYTHON="
set "VENV=%~dp0.venv"
set "APP_URL=https://nezoko45-dev.github.io/voicechanger/chatterbox-test/"

echo.
echo  ==========================================
echo       CHATTERBOX - REAL VOICE CLONING
echo  ==========================================
echo.

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
  echo [ERROR] Python 3.11 is required but was not found.
  echo Install Python 3.11 x64 from https://www.python.org/downloads/
  echo Enable "Add Python to PATH" during installation.
  pause
  exit /b 1
)

echo [OK] Python 3.11 found.
if not exist "%VENV%\Scripts\python.exe" (
  echo [SETUP] Creating isolated Chatterbox environment...
  %PYTHON% -m venv "%VENV%"
  if errorlevel 1 goto :fail
)

set "VPY=%VENV%\Scripts\python.exe"
echo [CHECK] Checking pip...
"%VPY%" -m pip --version >nul 2>nul
if errorlevel 1 (
  echo [SETUP] Repairing pip...
  "%VPY%" -m ensurepip --upgrade
  if errorlevel 1 goto :fail
)

echo [CHECK] Checking Chatterbox and server dependencies...
"%VPY%" -c "import chatterbox, fastapi, uvicorn, multipart, torchaudio" >nul 2>nul
if errorlevel 1 (
  echo [SETUP] Installing Chatterbox voice cloning dependencies.
  echo This first install is large and may take several minutes.
  "%VPY%" -m pip install --upgrade pip
  if errorlevel 1 goto :fail
  "%VPY%" -m pip install -r requirements.txt
  if errorlevel 1 goto :fail
) else (
  echo [OK] Chatterbox dependencies are installed.
)

echo.
echo [CHECK] Detecting GPU...
where nvidia-smi >nul 2>nul
if not errorlevel 1 (
  nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
) else (
  echo [INFO] NVIDIA utility not found. Chatterbox will use CPU unless CUDA is available.
)

echo.
echo [START] Launching local Chatterbox API at http://127.0.0.1:8765
start "Chatterbox Local Engine" cmd /k ""%VPY%" "%~dp0server.py""
timeout /t 3 /nobreak >nul
echo [OPEN] Opening the GitHub Pages voice-cloning app...
start "" "%APP_URL%"
echo.
echo The local engine runs in its own window.
echo Keep that window open while generating cloned speech.
echo.
pause
exit /b 0

:fail
echo.
echo [ERROR] Setup failed. The error above explains what went wrong.
echo If this is a GPU/PyTorch compatibility issue, send me the error text.
pause
exit /b 1
