@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Local VoiceChanger

set "ROOT=%~dp0"
set "PYEXE="

if exist "%LocalAppData%\Programs\Python\Python312\python.exe" set "PYEXE=%LocalAppData%\Programs\Python\Python312\python.exe"
if not defined PYEXE if exist "%ProgramFiles%\Python312\python.exe" set "PYEXE=%ProgramFiles%\Python312\python.exe"
if not defined PYEXE (
    py -3.12 --version >nul 2>&1
    if not errorlevel 1 set "PYEXE=py -3.12"
)
if not defined PYEXE (
    python --version >nul 2>&1
    if not errorlevel 1 set "PYEXE=python"
)

if not defined PYEXE (
    echo.
    echo ERROR: Python was not found.
    echo Install Python 3.12 and run this file again.
    echo.
    pause
    exit /b 1
)

if not exist "%ROOT%web\local_server.py" (
    echo ERROR: web\local_server.py is missing.
    pause
    exit /b 1
)

if not exist "%ROOT%.venv\Scripts\python.exe" (
    echo Creating local Python environment...
    %PYEXE% -m venv "%ROOT%.venv"
    if errorlevel 1 goto fail
)

set "VPY=%ROOT%.venv\Scripts\python.exe"

if not exist "%ROOT%.venv\voicechanger.ready" (
    echo.
    echo Installing local VoiceChanger packages...
    echo This is only needed once.
    echo.
    "%VPY%" -m pip install --upgrade pip setuptools wheel --disable-pip-version-check
    if errorlevel 1 goto fail
    "%VPY%" -m pip install -r "%ROOT%requirements.txt" --disable-pip-version-check --timeout 120
    if errorlevel 1 goto fail
    >"%ROOT%.venv\voicechanger.ready" echo ready
)

rem Start the server directly in its own console. No Railway or cloud service is used.
start "Local VoiceChanger Server" cmd /k "cd /d "%ROOT%web" && "%VPY%" local_server.py"

rem Wait until Flask responds, then open the local app.
echo Waiting for local server...
for /l %%N in (1,1,120) do (
    "%VPY%" -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/status',timeout=1)" >nul 2>&1
    if not errorlevel 1 goto ready
    timeout /t 1 /nobreak >nul
)

echo.
echo ERROR: Local server did not respond within 120 seconds.
echo Check the separate Local VoiceChanger Server window for the error.
pause
exit /b 1

:ready
start "" "http://127.0.0.1:8765/"
echo.
echo ========================================
echo     LOCAL VOICECHANGER RUNNING
 echo ========================================
echo.
echo Browser opened at http://127.0.0.1:8765/
echo Leave the server window open while using the app.
echo.
exit /b 0

:fail
echo.
echo ========================================
echo ERROR: LOCAL SETUP FAILED
 echo ========================================
echo.
echo The command above contains the actual error.
echo.
pause
exit /b 1
