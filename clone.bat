@echo off
setlocal
cd /d "%~dp0"
title OpenVoice V2 Clone

echo.
echo OpenVoice V2 clone launcher
echo.

where py >nul 2>nul
if errorlevel 1 (
 echo Python launcher "py" was not found.
 pause
 exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
 echo Creating local Python environment...
 py -3.9 -m venv .venv
 if errorlevel 1 (
  echo Could not create the Python environment.
  pause
  exit /b 1
 )

 echo Installing OpenVoice dependencies...
 ".venv\Scripts\python.exe" -m pip install --upgrade pip
 ".venv\Scripts\python.exe" -m pip install torch torchaudio librosa faster-whisper wavmark
 if errorlevel 1 (
  echo Dependency installation failed.
  pause
  exit /b 1
 )
)

if not exist "clone_server.py" (
 echo clone_server.py is missing.
 pause
 exit /b 1
)

echo Starting clone program...
".venv\Scripts\python.exe" clone_server.py
pause
