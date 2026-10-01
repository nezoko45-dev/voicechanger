@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Pocket TTS Local Voice Host
color 0A

echo ================================================
echo       POCKET TTS LOCAL VOICE HOST
echo ================================================
echo.

REM Prefer the Python launcher, then python.exe, then py.exe.
set "PYEXE="
where py >nul 2>nul
if not errorlevel 1 set "PYEXE=py"
if not defined PYEXE (
    where python >nul 2>nul
    if not errorlevel 1 set "PYEXE=python"
)
if not defined PYEXE (
    echo ERROR: Python was not found.
    echo.
    echo Install Python 3.10-3.13 from python.org with "Add python.exe to PATH" enabled.
    echo Do NOT use the Microsoft Store python alias for this setup.
    echo.
    pause
    exit /b 1
)

echo Using Python launcher: %PYEXE%
%PYEXE% --version
if errorlevel 1 (
    echo ERROR: The Python launcher could not start Python.
    pause
    exit /b 1
)

if not exist pocket_env (
    echo.
    echo Creating local Pocket TTS environment...
    %PYEXE% -m venv pocket_env
    if errorlevel 1 goto :venv_error
)

if not exist pocket_env\Scripts\python.exe goto :venv_error

set "VENV_PY=%~dp0pocket_env\Scripts\python.exe"

echo.
echo Updating pip...
"%VENV_PY%" -m pip install --upgrade pip --disable-pip-version-check
if errorlevel 1 goto :pip_error

echo.
echo Installing Pocket TTS dependencies...
"%VENV_PY%" -m pip install -r requirements.txt --disable-pip-version-check
if errorlevel 1 goto :pip_error

echo.
echo Starting LOCAL Pocket TTS inference engine...
echo This keeps the expensive model work outside Chrome.
echo.
start "Pocket TTS Engine" /min cmd /c ""%VENV_PY%" "%~dp0pocket_host.py""

timeout /t 5 /nobreak >nul

echo Local Pocket TTS host starting on ws://127.0.0.1:8765
echo Opening GitHub Pages voice changer...
start "" "https://nezoko45-dev.github.io/voicechanger/"
echo.
echo Keep the Pocket TTS Engine window open while using VRChat.
pause
exit /b 0

:venv_error
echo.
echo ERROR: Failed to create the Python environment.
echo Make sure Python 3.10-3.13 is installed from python.org.
echo.
pause
exit /b 1

:pip_error
echo.
echo ERROR: Failed to install Pocket TTS dependencies.
echo Check your internet connection and try again.
echo.
pause
exit /b 1
