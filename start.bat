@echo off
title Cartesia Voice Changer
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is required for the local Cartesia proxy.
  echo Install Node.js LTS, then run this file again.
  echo.
  pause
  exit /b 1
)
echo Starting Cartesia Voice Changer...
node server.js
pause
