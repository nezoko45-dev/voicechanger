@echo off
setlocal
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

if not exist ".venv\Lib\site-packages\imageio_ffmpeg" (
  echo FFmpeg helper is missing. Run setup.bat again to install audio decoder support.
  pause
  exit /b 1
)

echo Preparing bundled FFmpeg audio decoder...
".venv\Scripts\python.exe" ffmpeg-bootstrap.py
if errorlevel 1 (
  echo Could not prepare FFmpeg. Run setup.bat again.
  pause
  exit /b 1
)
set "PATH=%CD%\.tools\ffmpeg;%PATH%"

REM Public Seed-VC model downloads should not use an expired cached Hugging Face login.
REM Disable implicit auth and clear token environment variables for this process only.
set "HF_HUB_DISABLE_IMPLICIT_TOKEN=1"
set "HF_TOKEN="
set "HUGGING_FACE_HUB_TOKEN="

cd /d "%~dp0engine"
echo Starting Seed-VC. Choose your WAV or MP3 under "Load reference audio".
echo Select your microphone as Input Device and Voicemeeter / virtual cable as Output Device.
echo FFmpeg is bundled for MP3 and WAV decoding.
echo Public model downloads will run without your saved Hugging Face login.
echo NOTE: CPU-only conversion may be too slow for smooth live use on this PC.
"..\.venv\Scripts\python.exe" real-time-gui.py --fp16 False --gpu 0
if errorlevel 1 (
  echo.
  echo Seed-VC exited with an error.
  pause
)
