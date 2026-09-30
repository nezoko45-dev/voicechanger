@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo Python 3 is required. Install Python 3.12 from python.org.
  pause
  exit /b 1
)

if not exist .qwen-venv (
  echo Creating local Qwen3-TTS environment...
  py -3.12 -m venv .qwen-venv
  if errorlevel 1 py -3 -m venv .qwen-venv
  if errorlevel 1 (
    echo Could not create the Python environment.
    pause
    exit /b 1
  )
)

call .qwen-venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements-qwen.txt

set QWEN_MODEL=Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice
python qwen_server.py
pause
