@echo off
setlocal EnableExtensions
title Seed-VC Live Reference Voice Converter
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Run setup.bat first.
  pause
  exit /b 1
)
if not exist "engine\real-time-gui.py" (
  echo Seed-VC engine is missing. Run setup.bat again.
  pause
  exit /b 1
)

echo.
echo [1/3] Checking audio decoder...
REM Repair the decoder dependency here too, so users do not have to guess whether setup was rerun.
".tools\uv.exe" pip install --python ".venv\Scripts\python.exe" imageio-ffmpeg==0.6.0 audioread
if errorlevel 1 (
  echo Could not install the audio decoder. Check your internet connection and rerun setup.bat.
  pause
  exit /b 1
)

".venv\Scripts\python.exe" ffmpeg-bootstrap.py
if errorlevel 1 (
  echo Could not prepare bundled FFmpeg.
  pause
  exit /b 1
)

set "FFMPEG_DIR=%CD%\.tools\ffmpeg"
if not exist "%FFMPEG_DIR%\ffmpeg.exe" (
  echo FFmpeg executable was not created.
  pause
  exit /b 1
)
set "PATH=%FFMPEG_DIR%;%PATH%"
set "IMAGEIO_FFMPEG_EXE=%FFMPEG_DIR%\ffmpeg.exe"

echo [2/3] Verifying FFmpeg and audioread...
"%FFMPEG_DIR%\ffmpeg.exe" -version >nul 2>&1
if errorlevel 1 (
  echo Bundled FFmpeg failed its version check.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -c "import shutil,audioread; p=shutil.which('ffmpeg'); b=audioread.available_backends(); print('FFmpeg found:',p); print('audioread backends:',[x.__name__ for x in b]); assert p and b, 'No audio decoder backend is available'"
if errorlevel 1 (
  echo.
  echo Audio decoder preflight failed. Please send a screenshot of this message.
  pause
  exit /b 1
)

REM Public Seed-VC model downloads should not use an expired cached Hugging Face login.
set "HF_HUB_DISABLE_IMPLICIT_TOKEN=1"
set "HF_TOKEN="
set "HUGGING_FACE_HUB_TOKEN="

echo [3/3] Starting Seed-VC...
echo Choose your WAV or MP3 under "Load reference audio".
echo Select your microphone as Input Device and Voicemeeter / virtual cable as Output Device.
echo FFmpeg decoder preflight passed.
echo NOTE: CPU-only conversion may be too slow for smooth live use on this PC.
cd /d "%~dp0engine"
"..\.venv\Scripts\python.exe" real-time-gui.py --fp16 False --gpu 0
if errorlevel 1 (
  echo.
  echo Seed-VC exited with an error.
  pause
)
