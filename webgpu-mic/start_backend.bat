@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher was not found. Install Python 3.10+ and enable "Add Python to PATH".
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo Creating local Python environment...
  py -3 -m venv .venv
  if errorlevel 1 goto failed
)
echo Installing or updating VoiceClonNX dependencies...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failed
echo.
echo Starting VoiceClonNX API at http://127.0.0.1:8765
echo First conversion downloads model files and may take time.
".venv\Scripts\python.exe" server.py
pause
exit /b 0
:failed
echo.
echo Setup failed. Check the error above and confirm internet access for the first dependency install.
pause
exit /b 1
