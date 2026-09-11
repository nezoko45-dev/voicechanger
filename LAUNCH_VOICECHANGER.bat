@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo   LOCAL VOICECHANGER
echo ========================================
echo.

where py >nul 2>nul
if %errorlevel%==0 (set "PY=py") else (set "PY=python")

%PY% --version >nul 2>&1
if errorlevel 1 (
    echo Python was not found.
    echo Install Python 3.12 and run this file again.
    pause
    exit /b 1
)

if not exist "web\local_server.py" (
    echo ERROR: The web folder is missing.
    echo.
    echo This launcher must be run from a copy of the VoiceChanger repository.
    echo Download the entire repository ZIP from GitHub, extract it, then run:
    echo LAUNCH_VOICECHANGER.bat
    echo.
    pause
    exit /b 1
)

cd /d "%~dp0web"

echo Checking required packages...
%PY% -c "import flask, soundfile, faster_whisper, qwen_tts, torch" >nul 2>&1
if errorlevel 1 (
    echo Installing missing packages...
    %PY% -m pip install flask numpy soundfile faster-whisper qwen-tts "torch>=2.6"
    if errorlevel 1 (
        echo.
        echo Package installation failed.
        pause
        exit /b 1
    )
)

echo.
echo Starting VoiceChanger server...
start "VoiceChanger Python Server" "%PY%" local_server.py

echo Waiting for the local server...
set "READY=0"
for /l %%N in (1,1,90) do (
    powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8765/api/status' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {} ; exit 1" >nul 2>&1
    if not errorlevel 1 (
        set "READY=1"
        goto server_ready
    )
    timeout /t 1 /nobreak >nul
)

:server_ready
if "%READY%"=="0" (
    echo.
    echo ERROR: The Python server did not start within 90 seconds.
    echo Check the VoiceChanger Python Server window for the exact error.
    echo.
    pause
    exit /b 1
)

start "" "http://127.0.0.1:8765/"
echo.
echo VoiceChanger is running!
echo Keep the Python server window open while using it.
echo.
exit /b 0
