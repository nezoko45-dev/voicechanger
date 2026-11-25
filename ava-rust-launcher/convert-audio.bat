@echo off
setlocal
cd /d "%~dp0"
title RVC WAV MP3 Batch Converter
if not exist "%~dp0convert-audio.ps1" (
  echo ERROR: convert-audio.ps1 is missing.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0convert-audio.ps1"
