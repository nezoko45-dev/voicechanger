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
 pause
 exit /b 1
)
if not exist "package.json" (
 echo package.json is missing.
 pause
 exit /b 1
)
echo Checking Node and Electron dependencies...
call npm install
if errorlevel 1 (
 echo npm install failed.
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
if not errorlevel 1 goto start_electron
if %n% GEQ 30 goto fail
timeout /t 1 /nobreak >nul
goto wait
:start_electron
echo Server is online.
echo Starting Electron audio source...
start "VoiceChanger Audio Source" /D "%~dp0" cmd /k "npm run electron"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8765/"
echo VoiceChanger is ready.
echo Chrome is the controller.
echo Electron supplies the microphone audio only.
pause
exit /b 0
:fail
echo.
echo VoiceChanger did not start within 30 seconds.
echo Check the VoiceChanger Server window for the actual error.
pause
exit /b 1
