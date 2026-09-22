@echo off
setlocal
cd /d "%~dp0"
title VoiceChanger - Chrome

echo ==========================================
echo VOICECHANGER - CHROME APP
echo ==========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

if not exist "server.mjs" (
  echo ERROR: server.mjs is missing.
  pause
  exit /b 1
)

echo Starting the local web server...
start "VoiceChanger Server" /D "%~dp0" cmd /k "node server.mjs"

set /a n=0

:wait
set /a n+=1
curl.exe -s -f --max-time 2 http://127.0.0.1:8765/health >nul 2>&1
if not errorlevel 1 goto launch

if %n% GEQ 30 goto fail

timeout /t 1 /nobreak >nul
goto wait

:launch
echo.
echo Server is online.
echo Opening VoiceChanger in Chrome...
start "" "chrome.exe" --new-window "http://127.0.0.1:8765/"

echo.
echo VoiceChanger is now running from localhost.
echo Use the app's "Allow / Detect Microphones" button.
echo Do NOT open index.html directly from a file.
echo.
exit /b 0

:fail
echo.
echo ERROR: The local VoiceChanger server did not start.
echo Check the "VoiceChanger Server" window for the exact error.
echo.
pause
exit /b 1
