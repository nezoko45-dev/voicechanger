@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>&1
if errorlevel 1 (
  echo Python launcher ^(py^) was not found.
  echo Install Python 3.13 or newer and enable the Python launcher.
  pause
  exit /b 1
)

if not exist .venv (
  echo Creating local OpenVoice V2 environment...
  py -3 -m venv .venv
  if errorlevel 1 (
    echo Failed to create the virtual environment.
    pause
    exit /b 1
  )
)

call .venv\Scripts\activate.bat
if errorlevel 1 (
  echo Failed to activate .venv.
  pause
  exit /b 1
)

echo Upgrading pip...
python -m pip install --upgrade pip
if errorlevel 1 goto :pipfail

echo Installing OpenVoice V2 mic dependencies...
python -m pip install -r requirements.txt
if errorlevel 1 goto :pipfail

echo.
echo Starting OpenVoice V2 local server...
python -m uvicorn server:app --host 127.0.0.1 --port 8765
pause
exit /b 0

:pipfail
echo.
echo Dependency installation failed.
echo voiceclonnx is pinned to the currently published prerelease 0.0.3a3.
echo Uvicorn will only be available after the dependency installation completes.
pause
exit /b 1
