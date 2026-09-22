@echo off
setlocal
cd /d "%~dp0"
title VoiceChanger
if not exist "VoiceChanger.exe" (
  echo VoiceChanger.exe is missing.
  echo Download the Windows build artifact and place VoiceChanger.exe beside this file.
  pause
  exit /b 1
)
start "" "VoiceChanger.exe"
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
exit /b 0
:fail
echo VoiceChanger.exe did not start its local control server.
pause
