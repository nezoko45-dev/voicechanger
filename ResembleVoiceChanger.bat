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
echo Closing any old voice changer servers...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8787"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8799"') do taskkill /F /PID %%a >nul 2>&1

echo Starting NEW Resemble Voice Changer on port 8799...
start "" "http://127.0.0.1:8799/ResembleVoiceChanger.html?v=20260923NEW"
node server.js
pause
