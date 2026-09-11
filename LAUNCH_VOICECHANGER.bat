@echo off
setlocal
cd /d "%~dp0web"

echo ========================================
echo   LOCAL VOICECHANGER
 echo ========================================
echo.

where py >nul 2>nul
if %errorlevel%==0 (set PY=py) else (set PY=python)

%PY% --version >nul 2>&1
if errorlevel 1 (
    echo Python was not found.
    echo Install Python 3.12 and run this file again.
    pause
    exit /b 1
)

echo Checking required packages...
%PY% -c "import flask, soundfile, faster_whisper, qwen_tts, torch" >nul 2>&1
if errorlevel 1 (
    echo Some packages are missing. Installing them now...
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
echo The server window will stay visible so startup errors can be seen.
echo.
start "VoiceChanger Python Server" "%PY%" local_server.py

echo Waiting for http://127.0.0.1:8765/ ...
set READY=0
for /l %%N in (1,1,60) do (
    powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8765/api/status' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {} ; exit 1" >nul 2>&1
    if not errorlevel 1 (
        set READY=1
        goto server_ready
    )
    timeout /t 1 /nobreak >nul
)

:server_ready
if "%READY%"=="0" (
    echo.
    echo ERROR: The Python server did not start.
    echo Look at the VoiceChanger Python Server window for the error.
    echo.
    pause
    exit /b 1
)

start "" "http://127.0.0.1:8765/"
echo.
echo VoiceChanger is now running.
echo Keep the VoiceChanger Python Server window open.
echo.
exit /b 0
