@echo off
setlocal
cd /d "%~dp0"
title VoiceChanger

echo ==========================================
echo VOICECHANGER - ELECTRON
echo ==========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo ERROR: package.json is missing.
  pause
  exit /b 1
)

if not exist "server.mjs" (
  echo ERROR: server.mjs is missing.
  pause
  exit /b 1
)

echo Checking server syntax...
node --check server.mjs
if errorlevel 1 (
  echo.
  echo ERROR: server.mjs has a JavaScript syntax error.
  echo The launcher will NOT start the broken backend.
  pause
  exit /b 1
)

echo.
echo Installing/checking dependencies...
call npm install
if errorlevel 1 (
  echo.
  echo ERROR: npm install failed.
  pause
  exit /b 1
)

echo.
echo Starting VoiceChanger backend...
start "VoiceChanger Backend" /D "%~dp0" cmd /k "node server.mjs"

set /a n=0

:wait
set /a n+=1
curl.exe -s -f --max-time 2 http://127.0.0.1:8765/health >nul 2>&1
if not errorlevel 1 goto launch

if %n% GEQ 45 goto fail

timeout /t 1 /nobreak >nul
goto wait

:launch
echo Backend is online.
echo Launching the real Electron application...
start "" /D "%~dp0" cmd /c "npm run electron"

echo.
echo VoiceChanger is now running as a real Electron desktop app.
echo Electron handles the UI and microphone capture.
echo The Node backend handles OpenVoice and WASAPI output.
echo.
exit /b 0

:fail
echo.
echo ERROR: VoiceChanger backend did not start within 45 seconds.
echo.
echo Check the "VoiceChanger Backend" window for the exact error.
pause
exit /b 1
