@echo off
setlocal
cd /d "%~dp0"
title OpenVoice V2 Clone Service

where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher "py" was not found.
  echo Install Python 3.9 and run this file again.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating local Python environment...
  py -3.9 -m venv .venv
  if errorlevel 1 (
    echo Could not create the Python 3.9 environment.
    pause
    exit /b 1
  )
)

echo Installing the small web-service dependency if needed...
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check flask
if errorlevel 1 (
  echo Flask installation failed.
  pause
  exit /b 1
)

echo.
echo IMPORTANT:
echo OpenVoice V2 itself and its checkpoints must already be installed in this folder.
echo The required converter files are:
echo   checkpoints_v2\converter\config.json
echo   checkpoints_v2\converter\checkpoint.pth
echo.
echo Starting local clone service...
".venv\Scripts\python.exe" clone_server.py
pause
