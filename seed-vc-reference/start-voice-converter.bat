@echo off
setlocal EnableExtensions
title Seed-VC Live Reference Voice Converter
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Run setup.bat first.
  pause
  exit /b 1
)
if not exist ".tools\uv.exe" (
  echo The private uv installer is missing. Run setup.bat again.
  pause
  exit /b 1
)
if not exist "engine\real-time-gui.py" (
  echo Seed-VC engine is missing. Run setup.bat again.
  pause
  exit /b 1
)

echo.
echo [1/3] Checking required audio decoder packages...
".venv\Scripts\python.exe" -c "import imageio_ffmpeg,audioread"
if errorlevel 1 (
  echo Audio decoder packages are not installed in this environment.
  echo Installing them with the bundled uv manager - no pip module is needed...
  ".tools\uv.exe" pip install --python ".venv\Scripts\python.exe" imageio-ffmpeg==0.6.0 audioread
  if errorlevel 1 (
    echo.
    echo Decoder installation failed. Run setup.bat and wait for SETUP COMPLETE.
    pause
    exit /b 1
  )
)

echo Preparing bundled FFmpeg...
".venv\Scripts\python.exe" ffmpeg-bootstrap.py
if errorlevel 1 (
  echo Could not prepare bundled FFmpeg. Run setup.bat again.
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

echo [2/3] Verifying audio decoder...
"%FFMPEG_DIR%\ffmpeg.exe" -version >nul 2>&1
if errorlevel 1 (
  echo Bundled FFmpeg failed its version check.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -c "import shutil,audioread; print('FFmpeg found:',shutil.which('ffmpeg')); print('audioread backends:',[x.__name__ for x in audioread.available_backends()]); assert shutil.which('ffmpeg'), 'FFmpeg not found on PATH'; assert audioread.available_backends(), 'No audioread backend found'"
if errorlevel 1 (
  echo Audio decoder check failed. Send a screenshot of this section.
  pause
  exit /b 1
)

REM Public model downloads must not use an expired saved Hugging Face token.
set "HF_HUB_DISABLE_IMPLICIT_TOKEN=1"
set "HF_TOKEN="
set "HUGGING_FACE_HUB_TOKEN="

echo [3/3] Starting Seed-VC...
echo Choose your WAV or MP3 under "Load reference audio".
echo Select your microphone as Input Device and Voicemeeter / virtual cable as Output Device.
echo FFmpeg decoder check passed.
echo NOTE: CPU-only conversion may be too slow for smooth live use on this PC.
cd /d "%~dp0engine"
"..\.venv\Scripts\python.exe" real-time-gui.py --fp16 False --gpu 0
if errorlevel 1 (
  echo.
  echo Seed-VC exited with an error.
  pause
)
