@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo ========================================
echo   LOCAL VOICECHANGER - CLEAN INSTALL
echo ========================================
echo.
where py >nul 2>nul
if %errorlevel%==0 (set "PY=py") else (set "PY=python")
%PY% --version >nul 2>&1
if errorlevel 1 (echo Python 3.12+ is required. & pause & exit /b 1)
if not exist "web\local_server.py" (echo web\local_server.py is missing. & pause & exit /b 1)
if not exist ".venv\Scripts\python.exe" (
 echo Creating isolated Python environment...
 %PY% -m venv .venv
 if errorlevel 1 (echo Could not create virtual environment. & pause & exit /b 1)
)
set "VPY=%~dp0.venv\Scripts\python.exe"
echo Installing/updating required packages...
echo This only happens when the environment is first created or packages change.
"%VPY%" -m pip install --disable-pip-version-check --timeout 30 -r requirements.txt
if errorlevel 1 (echo. & echo Package installation failed. & pause & exit /b 1)
echo.
echo Starting local server...
start "VoiceChanger Python Server" cmd /k "cd /d "%~dp0web" && "%VPY%" local_server.py"
echo Waiting for server...
for /l %%N in (1,1,60) do (
 powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8765/api/status -TimeoutSec 1;if($r.StatusCode -eq 200){exit 0}}catch{};exit 1" >nul 2>&1
 if not errorlevel 1 goto ready
 timeout /t 1 /nobreak >nul
)
echo Server did not respond within 60 seconds. Check its open window for the error.
pause
exit /b 1
:ready
start "" "http://127.0.0.1:8765/"
echo VoiceChanger is running.
exit /b 0
