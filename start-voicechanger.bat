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
 echo Install Node.js 20 or newer, then run this BAT again.
 pause
 exit /b 1
)

if not exist "package.json" (
 echo package.json is missing.
 pause
 exit /b 1
)

echo Checking Node dependencies...
call npm install
if errorlevel 1 (
 echo.
 echo npm install failed.
 echo Keep this window open and read the error above.
 pause
 exit /b 1
)

echo.
echo Starting VoiceChanger server...
start "VoiceChanger Server" /D "%~dp0" cmd /k "node server.mjs"

set /a n=0
:wait
set /a n+=1
curl.exe -s -f --max-time 2 http://127.0.0.1:8765/health >nul 2>&1
if not errorlevel 1 goto open
if %n% GEQ 30 goto fail
timeout /t 1 /nobreak >nul
goto wait

:open
echo Server is online.
start "" "http://127.0.0.1:8765/"
echo VoiceChanger is ready.
echo You can close this launcher window.
pause
exit /b 0

:fail
echo.
echo VoiceChanger did not start within 30 seconds.
echo Check the "VoiceChanger Server" window for the actual error.
pause
exit /b 1
