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

cd /d "%~dp0engine"
echo Starting Seed-VC. Choose your WAV or MP3 under "Load reference audio".
echo Select your microphone as Input Device and Voicemeeter / virtual cable as Output Device.
echo NOTE: CPU-only conversion may be too slow for smooth live use on this PC.
"..\.venv\Scripts\python.exe" real-time-gui.py --fp16 False --gpu 0
if errorlevel 1 (
  echo.
  echo Seed-VC exited with an error.
  pause
)
