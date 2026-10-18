@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  set "PYTHON=py -3"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python 3.10 or newer is required.
    echo Install it from https://www.python.org/downloads/ and enable Add Python to PATH.
    pause
    exit /b 1
  )
  set "PYTHON=python"
)

if not exist ".venv\\Scripts\\python.exe" (
  echo Creating Python virtual environment...
  %PYTHON% -m venv .venv
  if errorlevel 1 goto failed
)

echo Installing or updating backend dependencies...
".venv\\Scripts\\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto failed
".venv\\Scripts\\python.exe" -m pip install -r backend\\requirements.txt
if errorlevel 1 goto failed

echo.
echo VoiceChanger backend starting at http://127.0.0.1:8765
echo Keep this window open while using the extension.
echo Press Ctrl+C to stop.
".venv\\Scripts\\python.exe" -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
goto end

:failed
echo.
echo Setup failed. Check the error above and verify Python 3.10+ is installed.
pause
exit /b 1

:end
endlocal
