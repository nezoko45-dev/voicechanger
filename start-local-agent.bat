@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Local Python Voice Agent

echo ==========================================================
echo              LOCAL PYTHON VOICE AGENT
echo ==========================================================
echo.
echo Whisper STT + Ollama LLM + Piper TTS
echo No Deepgram. No Moshi. No paid API.
echo.

where py >nul 2>&1
if %errorlevel%==0 (
  py -3.12 -c "import sys; print(sys.version)" >nul 2>&1
  if not errorlevel 1 (
    set "PY=py -3.12"
  ) else (
    set "PY=py -3"
  )
) else (
  where python >nul 2>&1
  if errorlevel 1 (
    echo Python was not found.
    echo Install Python 3.12 or newer, then run this file again.
    pause
    exit /b 1
  )
  set "PY=python"
)

if not exist "%~dp0.local-agent-env\Scripts\python.exe" (
  echo Creating local Python environment...
  %PY% -m venv "%~dp0.local-agent-env"
  if errorlevel 1 (
    echo Could not create the Python environment.
    pause
    exit /b 1
  )
)

set "PYTHON=%~dp0.local-agent-env\Scripts\python.exe"

echo Installing local agent packages...
"%PYTHON%" -m pip install --upgrade pip
if errorlevel 1 goto :fail
"%PYTHON%" -m pip install -r "%~dp0requirements-local-agent.txt"
if errorlevel 1 goto :fail

echo.
where ollama >nul 2>&1
if errorlevel 1 (
  echo Ollama was not found.
  echo.
  echo Install Ollama for Windows, then run this launcher again.
  echo Official installer: https://ollama.com/download/windows
  echo.
  pause
  exit /b 1
)

echo Checking local Ollama model...
ollama show llama3.2:3b >nul 2>&1
if errorlevel 1 (
  echo Downloading llama3.2:3b...
  ollama pull llama3.2:3b
  if errorlevel 1 goto :fail
)

echo.
echo ==========================================================
echo AGENT READY
echo ==========================================================
echo.
echo Speak into the selected/default microphone.
echo Replies are played through the selected/default Windows output.
echo.
"%PYTHON%" "%~dp0local-agent.py"
goto :eof

:fail
echo.
echo ==========================================================
echo SETUP FAILED
echo ==========================================================
echo.
echo The error above is the actual setup error.
pause
exit /b 1
