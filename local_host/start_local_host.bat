@echo off
setlocal
cd /d "%~dp0"
title Pocket TTS Local Voice Host
color 0A

echo ================================================
echo       POCKET TTS LOCAL VOICE HOST
 echo ================================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python 3.10-3.14 is required for Pocket TTS.
    echo Install Python and run this file again.
    pause
    exit /b 1
)

if not exist pocket_env (
    echo Creating local Pocket TTS environment...
    python -m venv pocket_env
    if errorlevel 1 goto :venv_error
)

call pocket_env\Scripts\activate.bat
python -m pip install --upgrade pip --disable-pip-version-check
if errorlevel 1 goto :pip_error

python -m pip install -r requirements.txt --disable-pip-version-check
if errorlevel 1 goto :pip_error

echo.
echo Starting LOCAL Pocket TTS inference engine...
echo This keeps the expensive model work outside Chrome.
echo.
start "Pocket TTS Engine" /min cmd /c "call "%~dp0pocket_env\Scripts\activate.bat" ^&^& python "%~dp0pocket_host.py""

timeout /t 5 /nobreak >nul

echo Local Pocket TTS host starting on ws://127.0.0.1:8765
echo Opening GitHub Pages voice changer...
start "" "https://nezoko45-dev.github.io/voicechanger/"
echo.
echo Keep the Pocket TTS Engine window open while using VRChat.
pause
exit /b 0

:venv_error
echo Failed to create the Python environment.
pause
exit /b 1

:pip_error
echo Failed to install Pocket TTS dependencies.
pause
exit /b 1
