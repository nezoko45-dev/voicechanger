@echo off
setlocal
cd /d "%~dp0"
title OpenVoice V2 Voice Clone

echo ========================================
echo       OpenVoice V2 Voice Clone
echo ========================================
echo.

where py >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python was not found.
    echo Install Python 3.13 x64.
    pause
    exit /b 1
)

py -3.13 -c "import sys; print('Using Python '+sys.version)" >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python 3.13 was not found.
    echo Install Python 3.13 x64.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Creating Python 3.13 environment...
    py -3.13 -m venv .venv
    if errorlevel 1 (
        echo ERROR: Could not create the Python environment.
        pause
        exit /b 1
    )
)

if "%~1"=="" (
    echo.
    echo Drag your reference WAV file onto this clone.bat file.
    echo.
    pause
    exit /b 0
)

".venv\Scripts\python.exe" clone_voice.py "%~1"
echo.
pause
