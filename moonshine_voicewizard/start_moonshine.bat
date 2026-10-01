@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required for the local static server.
  echo Install Node.js, then run this again.
  pause
  exit /b 1
)
if not exist node_modules\http-server (
  echo Installing the local static server...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Failed to install the local server.
    pause
    exit /b 1
  )
)
echo Starting Moonshine Voice Wizard bridge...
start "Moonshine STT" "http://127.0.0.1:8790/"
call npx http-server . -a 127.0.0.1 -p 8790 -c-1
pause
