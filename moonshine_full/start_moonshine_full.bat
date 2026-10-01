@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo        MOONSHINE FULL VOICE APP
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

start "Moonshine Full Voice App" http://127.0.0.1:8788/
node serve.mjs

pause
