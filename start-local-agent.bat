@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Local Whisper + Piper Voice Repeater

echo ==========================================================
echo          LOCAL WHISPER + PIPER VOICE REPEATER
echo ==========================================================
echo.
echo 100%% local - no Ollama, no Deepgram, no cloud API.
echo.

where py >nul 2>&1
if %errorlevel%==0 (
  set "PY=py -3"
) else (
  where python >nul 2>&1
  if errorlevel 1 (
    echo Python was not found.
    echo Install Python 3.12, then run this file again.
    pause
    exit /b 1
  )
  set "PY=python"
)

if not exist "%~dp0.local-agent-env\Scripts\python.exe" (
  echo Creating small Python environment...
  %PY% -m venv "%~dp0.local-agent-env"
  if errorlevel 1 goto :fail
)

set "PYTHON=%~dp0.local-agent-env\Scripts\python.exe"

echo Installing Whisper + Piper...
"%PYTHON%" -m pip install --upgrade pip
if errorlevel 1 goto :fail
"%PYTHON%" -m pip install -r "%~dp0requirements-local-agent.txt"
if errorlevel 1 goto :fail

if not exist "%~dp0local_agent_data\voices\en_US-lessac-medium.onnx" (
  echo.
  echo Downloading Piper voice...
  "%PYTHON%" -m piper.download_voices --data-dir "%~dp0local_agent_data\voices" en_US-lessac-medium
  if errorlevel 1 goto :fail
)

echo.
echo ==========================================================
echo READY
echo ==========================================================
echo.
echo Whisper hears you, then Piper repeats the words.
echo.
"%PYTHON%" "%~dp0local-agent.py"
goto :eof

:fail
echo.
echo ==========================================================
echo SETUP FAILED
echo ==========================================================
echo.
pause
exit /b 1
