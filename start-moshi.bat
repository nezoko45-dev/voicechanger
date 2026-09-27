@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title SpeechStack - Moshi Local Voice Agent

echo ==========================================
echo        SPEECHSTACK - MOSHI
echo ==========================================
echo.
echo Fully local voice agent - no Deepgram.
echo Moshi full-duplex speech-to-speech.
echo.

where py >nul 2>&1
if %errorlevel%==0 (
  set "PY=py -3.12"
) else (
  where python >nul 2>&1
  if errorlevel 1 (
    echo ERROR: Python 3.12 was not found.
    echo Install Python 3.12, then run this file again.
    pause
    exit /b 1
  )
  set "PY=python"
)

if not exist "%~dp0.moshi-env\Scripts\python.exe" (
  echo Creating Moshi environment...
  %PY% -m venv "%~dp0.moshi-env"
  if errorlevel 1 (
    echo ERROR: Could not create the Moshi Python environment.
    pause
    exit /b 1
  )
)

set "MOSHIPY=%~dp0.moshi-env\Scripts\python.exe"

echo.
echo Installing/updating Moshi...
"%MOSHIPY%" -m pip install --upgrade pip
if errorlevel 1 goto :pipfail
"%MOSHIPY%" -m pip install --upgrade moshi
if errorlevel 1 goto :pipfail

echo.
echo Starting Moshika local voice agent...
echo.
echo Browser UI: http://127.0.0.1:8998
echo Keep this window open while using Moshi.
echo Press Ctrl+C here to stop Moshi.
echo.

start "" "http://127.0.0.1:8998"
"%MOSHIPY%" -m moshi.server --hf-repo kyutai/moshika-pytorch-bf16
goto :eof

:pipfail
echo.
echo ERROR: Moshi could not be installed.
echo.
echo This model uses the PyTorch backend. Moshi's documentation says Windows
echo is not officially supported and the PyTorch model needs a GPU with
echo significant memory (about 24 GB).
echo.
pause
exit /b 1
