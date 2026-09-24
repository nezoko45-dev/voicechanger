@echo off
title Resemble Voice Changer
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is required.
  echo Install Node.js LTS, then run this file again.
  echo.
  pause
  exit /b 1
)
echo.
echo Starting Resemble Voice Changer...
start "" "http://127.0.0.1:8787/ResembleVoiceChanger.html?v=20260923"
node server.js
pause
