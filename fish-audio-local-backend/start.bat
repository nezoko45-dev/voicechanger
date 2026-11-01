@echo off
title Fish Audio Local Backend
echo ==========================================
echo       Fish Audio Local Backend
echo ==========================================
echo.
set /p FISH_AUDIO_API_KEY=Paste your Fish Audio API key (input is visible): 
if "%FISH_AUDIO_API_KEY%"=="" (
  echo No API key entered.
  pause
  exit /b 1
)
echo.
echo Starting local backend...
fish-audio-local-backend.exe
if errorlevel 1 (
  echo.
  echo Backend exited with an error.
  pause
)
