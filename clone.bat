@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title OpenVoice V2 Voice Clone

echo ========================================
echo       OpenVoice V2 Voice Clone
echo ========================================
echo.

REM Keep the window open even if something fails.
if "%~1"=="" goto NO_FILE

set "SOURCE=%~1"
if /I not "%~x1"==".wav" (
    echo ERROR: Please drop a WAV file onto clone.bat.
    echo.
    pause
    exit /b 1
)

echo Reference file:
echo "%SOURCE%"
echo.

where py >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python is not installed or the Python launcher is unavailable.
    echo.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Creating local Python environment...
    py -3 -m venv .venv
    if errorlevel 1 (
        echo.
        echo ERROR: Could not create the Python environment.
        echo.
        pause
        exit /b 1
    )
)

echo.
echo Installing/checking clone dependencies...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements-clone.txt
if errorlevel 1 (
    echo.
    echo ERROR: Dependencies failed to install.
    echo The batch file is still here. Nothing was deleted.
    echo.
    pause
    exit /b 1
)

echo.
echo Starting OpenVoice V2...
echo DO NOT CLOSE THIS WINDOW.
echo.

".venv\Scripts\python.exe" clone_voice.py "%SOURCE%"
set "RESULT=%ERRORLEVEL%"

echo.
if "%RESULT%"=="0" (
    echo ========================================
    echo CLONE FINISHED
    echo ========================================
    echo Check the cloned_voice folder.
) else (
    echo ========================================
    echo CLONE FAILED - NOTHING WAS DELETED
    echo ========================================
    echo The error is shown above.
)
echo.
pause
exit /b %RESULT%

:NO_FILE
echo Drag a WAV file directly onto this clone.bat file.
echo.
pause
exit /b 0
