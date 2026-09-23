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
    echo ERROR: Python is not installed.
    echo Install a current Python 3.x version.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Creating local Python environment...
    py -3 -m venv .venv
    if errorlevel 1 (
        echo ERROR: Could not create the Python environment.
        pause
        exit /b 1
    )
)

".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements-clone.txt
if errorlevel 1 (
    echo.
    echo ERROR: Python dependencies could not be installed.
    pause
    exit /b 1
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
