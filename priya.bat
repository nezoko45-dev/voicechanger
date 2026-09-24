@echo off
setlocal
cd /d "%~dp0"
title PRIYA - Deepgram Flux v2
echo ==========================================
echo        PRIYA - DEEPGRAM FLUX v2
echo ==========================================
echo.
echo Opening the NEW Flux v2 repeat-me app...
echo Listen: flux-general-en (v2)
echo Voice: Priya - flux-priya-en (v2)
echo Mic: continuous streaming
echo Buffer: NONE
echo.
set "URL=http://127.0.0.1:8799/priya-flux-v2.html?v=FLUX-V2-20260925"
where py >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  py -m http.server 8799 --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  python -m http.server 8799 --bind 127.0.0.1
  goto :eof
)
echo ERROR: Python is not installed.
pause
