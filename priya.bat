@echo off
setlocal
cd /d "%~dp0"
title PRIYA - Deepgram Flux v2 Agent
echo ==========================================
echo       PRIYA - FLUX v2 VOICE AGENT
echo ==========================================
echo.
echo Opening the NEW Flux v2 Agent app...
echo This uses ONE Deepgram Voice Agent WebSocket.
echo The page does not create separate STT or TTS connections.
echo.
set "URL=http://127.0.0.1:8808/priya-flux-agent.html?v=FLUX-V2-AGENT-20260925"
where py >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  py -m http.server 8808 --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  python -m http.server 8808 --bind 127.0.0.1
  goto :eof
)
echo ERROR: Python is not installed.
pause
