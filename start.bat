@echo off
setlocal
cd /d "%~dp0"

title Deepgram - OpenVoice V2

echo.
echo ==========================================
echo   Deepgram - OpenVoice V2 Voice Changer
echo ==========================================
echo.
echo Folder: %CD%
echo.

if not exist "server.py" (
  echo ERROR: server.py was not found.
  echo Make sure this BAT file is inside the voicechanger folder.
  pause
  exit /b 1
)

if not exist "requirements.txt" (
  echo ERROR: requirements.txt was not found.
  pause
  exit /b 1
)

where py >nul 2>nul
if %errorlevel%==0 (
  set "PY=py"
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    set "PY=python"
  ) else (
    echo ERROR: Python was not found.
    echo Install Python 3.10 or newer and enable "Add Python to PATH".
    pause
    exit /b 1
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment...
  %PY% -m venv ".venv"
  if errorlevel 1 (
    echo ERROR: Could not create the virtual environment.
    pause
    exit /b 1
  )
)

echo Installing required packages...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 (
  echo ERROR: pip setup failed.
  pause
  exit /b 1
)

".venv\Scripts\python.exe" -m pip install -r "requirements.txt"
if errorlevel 1 (
  echo ERROR: Dependency installation failed.
  pause
  exit /b 1
)

echo.
echo Starting local voice server...
echo Open http://127.0.0.1:8765 in Chrome.
echo.
".venv\Scripts\python.exe" -m uvicorn server:app --host 127.0.0.1 --port 8765

if errorlevel 1 (
  echo.
  echo ERROR: The voice server stopped.
)

pause
