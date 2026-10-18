@echo off
setlocal
cd /d "%~dp0"
title VoiceChanger - VoiceClonNX
echo.
echo  VoiceChanger - VoiceClonNX local backend
echo  ----------------------------------------
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  set "PYTHON=py -3"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python 3.10 or newer was not found.
    echo Install Python from https://www.python.org/downloads/
    echo Make sure "Add Python to PATH" is checked.
    pause
    exit /b 1
  )
  set "PYTHON=python"
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating local Python environment...
  %PYTHON% -m venv .venv
  if errorlevel 1 goto failed
)

echo Installing or updating required packages...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install voiceclonnx fastapi "uvicorn[standard]" python-multipart
if errorlevel 1 goto failed

echo.
echo Starting local VoiceClonNX API at http://127.0.0.1:8765
echo Keep this window open while converting audio.
echo Models are downloaded by VoiceClonNX on first use.
echo.
".venv\Scripts\python.exe" server.py
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo Setup or startup failed. Read the error above, then retry.
pause
exit /b 1
