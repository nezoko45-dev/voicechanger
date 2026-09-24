@echo off
setlocal
cd /d "%~dp0"
title PRIYA - Deepgram Flux v2 Voice Agent
echo ==========================================
echo       PRIYA - FLUX v2 VOICE AGENT
echo ==========================================
echo.
echo Opening the fresh inline Flux v2 Voice Agent app...
echo ONE Deepgram Voice Agent WebSocket
echo No Agent ID required
echo.
set "URL=http://127.0.0.1:8818/priya-flux-v2.html?v=INLINE-FLUX-V2-AGENT-20260925"
where py >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  py -m http.server 8818 --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  python -m http.server 8818 --bind 127.0.0.1
  goto :eof
)
echo ERROR: Python is not installed.
pause
