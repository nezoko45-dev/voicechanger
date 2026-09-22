@echo off
setlocal
cd /d "%~dp0"
title OpenVoice V2 Clone

echo OpenVoice V2 Clone
echo ------------------
where py >nul 2>nul
if errorlevel 1 (
 echo Python was not found. Install Python 3.13 x64.
 pause
 exit /b 1
)

py -3.13 -c "import sys; print('Using Python '+sys.version)" 2>nul
if errorlevel 1 (
 echo Python 3.13 was not found.
 echo Python 3.14 is newer, but this OpenVoice setup is pinned to 3.13.
 echo Install Python 3.13 x64 and run this again.
 pause
 exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
 echo Creating Python 3.13 environment...
 py -3.13 -m venv .venv
 if errorlevel 1 (
  echo Could not create the Python 3.13 environment.
  pause
  exit /b 1
 )
)

".venv\Scripts\python.exe" --version
if not exist "clone_server.py" (
 echo clone_server.py is missing.
 pause
 exit /b 1
)

echo Starting OpenVoice clone...
".venv\Scripts\python.exe" clone_server.py
pause
