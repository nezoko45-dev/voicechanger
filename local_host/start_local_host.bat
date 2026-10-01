@echo off
setlocal
cd /d "%~dp0"
title Pocket TTS Local Voice Host
color 0A

echo ================================================
echo       POCKET TTS LOCAL VOICE HOST
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js is not installed or is not in PATH.
    echo Install Node.js, then run this file again.
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
        echo ERROR: npm install failed.
        pause
        exit /b 1
    )
)

start "Pocket TTS Local Host" /min cmd /c "node server.js"
timeout /t 1 /nobreak >nul

echo Local host started on ws://127.0.0.1:8765
echo Opening GitHub Pages voice changer...
echo.
start "" "https://nezoko45-dev.github.io/voicechanger/"

echo Keep this launcher window open.
echo Close the separate Pocket TTS Local Host window to stop the server.
pause
endlocal
