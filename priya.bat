@echo off
setlocal
cd /d "%~dp0"
title PRIYA - Deepgram Flux v2 Voice Agent
echo ==========================================
echo       PRIYA - FLUX v2 VOICE AGENT
echo ==========================================
echo.
echo Starting the fresh Flux v2 Agent app...
echo ONE Deepgram Voice Agent WebSocket
echo Automatic reconnect enabled
echo No Agent ID required
echo.
set "PORT=8898"
set "URL=http://127.0.0.1:%PORT%/priya-flux-v2.html?v=FLUX-V2-AGENT-RECONNECT-20260926"

where py >nul 2>nul
if not errorlevel 1 goto :use_py
where python >nul 2>nul
if not errorlevel 1 goto :use_python

echo ERROR: Python is not installed.
pause
exit /b 1

:use_py
echo Opening Priya...
start "" "%URL%"
echo Server is running on port %PORT%. Keep this window open.
:server_py
py -m http.server %PORT% --bind 127.0.0.1
echo.
echo Local server stopped. Restarting in 2 seconds...
timeout /t 2 /nobreak >nul
goto :server_py

:use_python
echo Opening Priya...
start "" "%URL%"
echo Server is running on port %PORT%. Keep this window open.
:server_python
python -m http.server %PORT% --bind 127.0.0.1
echo.
echo Local server stopped. Restarting in 2 seconds...
timeout /t 2 /nobreak >nul
goto :server_python
