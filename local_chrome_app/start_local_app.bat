@echo off
setlocal
cd /d "%~dp0"
title Local Pocket TTS Chrome App
color 0A

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Install Node.js, then run this again.
  pause
  exit /b 1
)

if not exist package.json (
  echo ERROR: local_chrome_app\package.json is missing.
  pause
  exit /b 1
)

if not exist node_modules\http-server (
  echo Installing local static server...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo ERROR: Could not install the static server.
    pause
    exit /b 1
  )
)

REM Serve the REPOSITORY ROOT, not local_chrome_app itself.
REM This makes ../pocket-tts/index.js and ../pocket-tts/player.js resolve correctly.
for %%I in ("%~dp0..") do set "REPO_ROOT=%%~fI"

 echo.
echo Starting local Pocket TTS web app...
echo Open: http://127.0.0.1:8787/local_chrome_app/
echo Keep this window open while using the app.
echo.
start "Pocket TTS Browser" "http://127.0.0.1:8787/local_chrome_app/"
call npx http-server "%REPO_ROOT%" -a 127.0.0.1 -p 8787 -c-1
pause
