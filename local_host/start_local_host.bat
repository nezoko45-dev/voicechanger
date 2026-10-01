@echo off
setlocal
cd /d "%~dp0"
title Pocket TTS Local Voice Host
color 0A

echo ================================================
echo       POCKET TTS LOCAL VOICE HOST
echo ================================================
echo.
echo Starting local JavaScript WebSocket server...
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js is not installed or is not in PATH.
    echo Install Node.js, then run this file again.
    echo.
    pause
    exit /b 1
)

if not exist package.json (
    echo ERROR: package.json was not found.
    pause
    exit /b 1
)

if not exist node_modules\ws (
    echo Installing the WebSocket dependency...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo ERROR: npm install failed.
        pause
        exit /b 1
    )
)

echo.
echo Local host starting on ws://127.0.0.1:8765
echo Keep this window open while using the GitHub Pages voice changer.
echo.
node server.js

echo.
echo Local host stopped.
pause
endlocal
