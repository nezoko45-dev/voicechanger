@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

title Local VoiceChanger Launcher

echo ========================================
echo       LOCAL VOICECHANGER
 echo ========================================
echo.

if not exist "web\local_server.py" (
    echo ERROR: web\local_server.py is missing.
    pause
    exit /b 1
)

REM Find a supported Python installation.
set "PYEXE="
py -3.12 --version >nul 2>&1
if not errorlevel 1 set "PYEXE=py -3.12"
if not defined PYEXE (
    python --version >nul 2>&1
    if not errorlevel 1 set "PYEXE=python"
)
if not defined PYEXE (
    echo ERROR: Python was not found.
    echo Install Python 3.12, then run this launcher again.
    echo.
    pause
    exit /b 1
)

echo Using Python:
%PYEXE% --version

echo.
if not exist ".venv\Scripts\python.exe" (
    echo Creating the local Python environment...
    %PYEXE% -m venv .venv
    if errorlevel 1 goto venv_failed
)

set "VPY=%~dp0.venv\Scripts\python.exe"
if not exist "%VPY%" goto venv_failed

REM Install/update requirements when the marker is missing.
if not exist ".venv\voicechanger.ready" (
    echo.
    echo Installing VoiceChanger requirements.
    echo This can take several minutes because PyTorch and AI models are large.
    echo DO NOT close this window while pip is working.
    echo.
    "%VPY%" -m pip install --upgrade pip setuptools wheel --disable-pip-version-check
    if errorlevel 1 goto install_failed
    "%VPY%" -m pip install -r requirements.txt --disable-pip-version-check --timeout 120
    if errorlevel 1 goto install_failed
    echo ready>".venv\voicechanger.ready"
    echo.
    echo Requirements installed successfully.
) else (
    echo Requirements are already installed.
)

echo.
echo Starting Python server...
start "VoiceChanger Python Server" cmd /k "cd /d ""%~dp0web"" ^&^& ""%VPY%"" ""local_server.py"""

if errorlevel 1 goto server_failed

echo Waiting for the server to respond...
for /l %%N in (1,1,120) do (
    "%VPY%" -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/status', timeout=1)" >nul 2>&1
    if not errorlevel 1 goto ready
    timeout /t 1 /nobreak >nul
)

echo.
echo ERROR: The Python server did not answer within 120 seconds.
echo.
echo The Python server window was left open so its exact error is visible.
echo If it shows an error, send that error to me and I will fix the repo.
pause
exit /b 1

:ready
start "" "http://127.0.0.1:8765/"
echo.
echo ========================================
echo     VOICECHANGER IS RUNNING
 echo ========================================
echo.
echo The browser has been opened automatically.
echo You can leave this launcher window open.
echo.
exit /b 0

:venv_failed
echo.
echo ERROR: Could not create the Python environment.
echo.
pause
exit /b 1

:install_failed
echo.
echo ERROR: Python package installation failed.
echo The complete pip error is above.
echo.
pause
exit /b 1

:server_failed
echo.
echo ERROR: Could not start the Python server window.
echo.
pause
exit /b 1
