@echo off
setlocal
cd /d "%~dp0"
title VoiceChanger
echo ==========================================
echo VOICECHANGER - ELECTRON
echo ==========================================
echo.
where node >nul 2>&1
if errorlevel 1 (echo Node.js 20+ is required.&pause&exit /b 1)
if not exist "package.json" (echo package.json is missing.&pause&exit /b 1)
echo Installing/checking dependencies...
call npm install
if errorlevel 1 (echo npm install failed.&pause&exit /b 1)
echo.
echo Starting VoiceChanger backend...
start "VoiceChanger Backend" /D "%~dp0" cmd /k "node server.mjs"
set /a n=0
:wait
set /a n+=1
curl.exe -s -f --max-time 2 http://127.0.0.1:8765/health >nul 2>&1
if not errorlevel 1 goto launch
if %n% GEQ 30 goto fail
timeout /t 1 /nobreak >nul
goto wait
:launch
echo Backend is online.
echo Launching the real Electron application...
start "" /D "%~dp0" cmd /c "npm run electron"
echo.
echo VoiceChanger is now an Electron desktop app.
echo No Chrome window is used.
echo.
exit /b 0
:fail
echo.
echo VoiceChanger backend did not start within 30 seconds.
echo Check the VoiceChanger Backend window for the error.
pause
exit /b 1
