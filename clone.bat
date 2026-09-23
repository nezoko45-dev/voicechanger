@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title OpenVoice V2 Voice Clone - Folder Watcher

set "INBOX=%~dp0clone_input"
set "OUTBOX=%~dp0cloned_voice"
set "PY=%~dp0.venv\Scripts\python.exe"

if not exist "%INBOX%" mkdir "%INBOX%"
if not exist "%OUTBOX%" mkdir "%OUTBOX%"

echo ========================================
echo       OpenVoice V2 Voice Clone
echo ========================================
echo.
echo Watching:
echo %INBOX%
echo.
echo Put ONE WAV file in that folder.
echo OpenVoice will automatically process it.
echo.
echo Press Ctrl+C to stop.
echo.

where py >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python launcher "py" was not found.
    pause
    exit /b 1
)

if not exist "%PY%" (
    echo Creating local Python environment...
    py -3 -m venv .venv
    if errorlevel 1 (
        echo ERROR: Could not create Python environment.
        pause
        exit /b 1
    )
)

echo Checking dependencies...
"%PY%" -m pip install --disable-pip-version-check -r requirements-clone.txt
if errorlevel 1 (
    echo ERROR: Dependencies could not be installed.
    pause
    exit /b 1
)

:WATCH
for %%F in ("%INBOX%\*.wav") do (
    if exist "%%~fF" (
        echo.
        echo ========================================
        echo WAV DETECTED: %%~nxF
        echo ========================================
        echo.

        "%PY%" clone_voice.py "%%~fF"
        if errorlevel 1 (
            echo.
            echo CLONE FAILED.
            echo The WAV was NOT deleted.
            echo Fix the error and restart this watcher.
            pause
            exit /b 1
        )

        echo.
        echo CLONE COMPLETE.
        echo Voice embedding saved in:
        echo %OUTBOX%
        echo.

        move /Y "%%~fF" "%INBOX%\processed\" >nul 2>nul
    )
)

if not exist "%INBOX%\processed" mkdir "%INBOX%\processed" >nul 2>nul
timeout /t 2 /nobreak >nul
goto WATCH
