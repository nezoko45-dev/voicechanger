@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if errorlevel 1 (
  echo Python 3 is required. Install Python 3.11+ and enable the py launcher.
  pause
  exit /b 1
)
if not exist .venv (
  echo Creating local OpenVoice V2 environment...
  py -3 -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn server:app --host 127.0.0.1 --port 8765
pause
