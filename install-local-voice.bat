@echo off
setlocal
cd /d "%~dp0"
title Local Voice Stack Installer
echo ==========================================
echo       LOCAL VOICE STACK INSTALLER
echo ==========================================
echo.
echo Installing local Whisper.cpp + Piper.
echo No Deepgram credits are used.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-local-voice.ps1"
if errorlevel 1 (
  echo.
  echo INSTALL FAILED.
  pause
  exit /b 1
)
echo.
echo INSTALL COMPLETE.
echo Run start-local-voice.bat next.
pause
