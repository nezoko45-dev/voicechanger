@echo off
setlocal
cd /d "%~dp0"
title VoiceChanger

echo ==========================================
echo VOICECHANGER
echo ==========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
 echo Node.js 20+ is required.
 echo Install Node.js, then run this BAT again.
 pause
 exit /b 1
)

if not exist "package.json" (
 echo package.json is missing.
 pause
 exit /b 1
)

if not exist "node_modules\onnxruntime-node" (
 echo Installing dependencies...
 call npm install
 if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
 )
)

echo Starting VoiceChanger...
start "VoiceChanger" cmd /k "cd /d ""%~dp0"" && node server.mjs"

set /a n=0
:wait
set /a n+=1
curl.exe -s -f --max-time 2 http://127.0.0.1:8765/health >nul 2>&1
if not errorlevel 1 goto open
if %n% GEQ 30 goto fail
timeout /t 1 /nobreak >nul
goto wait

:open
start "" "http://127.0.0.1:8765/"
echo VoiceChanger is ready.
pause
exit /b 0

:fail
echo VoiceChanger failed to start.
echo Check the VoiceChanger command window.
pause
exit /b 1
