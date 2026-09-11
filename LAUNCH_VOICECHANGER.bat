@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo   LOCAL VOICECHANGER
echo ========================================
echo.

REM Use Python 3.12 for the clean Qwen3-TTS environment.
py -3.12 --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python 3.12 was not found.
    echo Install Python 3.12 and run this file again.
    pause
    exit /b 1
)
set "PY=py -3.12"

if not exist "web\local_server.py" (
    echo ERROR: web\local_server.py is missing.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Creating isolated Python 3.12 environment...
    %PY% -m venv .venv
    if errorlevel 1 goto venv_failed
)

set "VPY=%~dp0.venv\Scripts\python.exe"

if not exist ".venv\voicechanger.ready" (
    echo.
    echo Installing STT, TTS, and voice-cloning requirements...
    echo This is a ONE-TIME install.
    echo.
    "%VPY%" -m pip install --upgrade pip setuptools wheel --disable-pip-version-check --no-input
    if errorlevel 1 goto install_failed
    "%VPY%" -m pip install -r requirements.txt --disable-pip-version-check --no-input --timeout 60
    if errorlevel 1 goto install_failed
    echo ready>".venv\voicechanger.ready"
    echo.
    echo Installation complete.
) else (
    echo Requirements already installed. Skipping package installation.
)

echo.
echo Starting local VoiceChanger server...
start "VoiceChanger Python Server" /D "%~dp0web" "%VPY%" local_server.py
if errorlevel 1 goto server_failed

echo Waiting for server...
set "READY=0"
for /l %%N in (1,1,90) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$r=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8765/api/status' -TimeoutSec 1;if($r.StatusCode -eq 200){exit 0}}catch{};exit 1" >nul 2>&1
    if not errorlevel 1 (
        set "READY=1"
        goto ready
    )
    timeout /t 1 /nobreak >nul
)

echo ERROR: The server did not respond within 90 seconds.
echo Keep the Python server window open and read its error.
pause
exit /b 1

:ready
start "" "http://127.0.0.1:8765/"
echo.
echo ========================================
echo   VOICECHANGER IS RUNNING
echo ========================================
echo.
exit /b 0

:venv_failed
echo ERROR: Could not create the Python 3.12 environment.
pause
exit /b 1

:install_failed
echo.
echo ERROR: Python package installation failed.
echo The install output above contains the actual package error.
pause
exit /b 1

:server_failed
echo ERROR: Could not start the local Python server.
pause
exit /b 1
