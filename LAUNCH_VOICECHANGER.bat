@echo off
setlocal
cd /d "%~dp0web"

where py >nul 2>nul
if %errorlevel%==0 (set PY=py) else (set PY=python)

%PY% --version >nul 2>&1
if errorlevel 1 (
    echo Python was not found.
    echo Install Python 3.12 and run this file again.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   LOCAL VOICECHANGER
 echo ========================================
echo.
echo Installing the required Python packages...
echo This launcher does NOT use requirements.txt.
echo.

%PY% -m pip install flask numpy soundfile faster-whisper qwen-tts "torch>=2.6"
if errorlevel 1 (
    echo.
    echo Package installation failed.
    pause
    exit /b 1
)

echo.
echo Starting local VoiceChanger server...
start "VoiceChanger Python Server" /min "%PY%" local_server.py

echo Waiting for the server to start...
timeout /t 5 /nobreak >nul

start "" "http://127.0.0.1:8765/"

echo.
echo VoiceChanger is opening in your browser.
echo Keep the Python server running while using the app.
echo.
exit /b 0
