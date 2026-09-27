@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Hugging Face Realtime - Local Setup
echo ==========================================================
echo       HUGGING FACE REALTIME - LOCAL SETUP
echo ==========================================================
echo.
where py >nul 2>&1
if errorlevel 1 (
  echo Python launcher not found.
  echo Install Python 3.11+ and run this again.
  pause
  exit /b 1
)
set "PY=py -3.11"
%PY% -c "import sys; raise SystemExit(0 if sys.version_info[:2]==(3,11) else 1)" >nul 2>&1
if errorlevel 1 set "PY=py"
if not exist ".hf-realtime-env\Scripts\python.exe" (
  echo Creating local Python environment...
  %PY% -m venv ".hf-realtime-env"
  if errorlevel 1 goto fail
)
set "P=.hf-realtime-env\Scripts\python.exe"
echo Installing Hugging Face Speech-to-Speech + Kokoro...
"%P%" -m pip install --upgrade pip
if errorlevel 1 goto fail
"%P%" -m pip install -U "speech-to-speech[kokoro]"
if errorlevel 1 goto fail
echo.
echo Setup complete.
echo Run hf-realtime-start.bat next.
pause
exit /b 0
:fail
echo.
echo SETUP FAILED. The window will stay open so you can read the error.
pause
exit /b 1
