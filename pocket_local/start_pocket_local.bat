@echo off
setlocal
cd /d "%~dp0"
title Pocket TTS Local Voice Server

echo ==========================================
echo       POCKET TTS LOCAL VOICE SERVER
 echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required for the local UI/backend.
  echo Install Node.js LTS and run this file again.
  pause
  exit /b 1
)

where uv >nul 2>nul
if errorlevel 1 (
  echo uv was not found. Installing uv...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
  set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)

where uv >nul 2>nul
if errorlevel 1 (
  echo.
  echo Could not find uv after installation.
  echo Close this window, open a new terminal, and run this BAT again.
  pause
  exit /b 1
)

echo.
echo First run may download Pocket TTS and its model weights.
echo The model stays loaded in the local server between requests.
echo.
start "Pocket TTS Chrome UI" http://localhost:3000/
node server.mjs
pause
