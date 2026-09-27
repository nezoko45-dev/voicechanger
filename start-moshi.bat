@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title SpeechStack - Moshi Local Voice Agent

echo ==========================================
echo        SPEECHSTACK - MOSHI
echo ==========================================
echo.
echo Fully local voice agent - no Deepgram.
echo Moshi full-duplex speech-to-speech.
echo.

where py >nul 2>&1
if %errorlevel%==0 (
  set "PY=py -3.12"
) else (
  where python >nul 2>&1
  if errorlevel 1 (
    echo ERROR: Python was not found.
    echo Install Python 3.12, then run this file again.
    pause
    exit /b 1
  )
  set "PY=python"
)

if not exist "%~dp0.moshi-env\Scripts\python.exe" (
  echo Creating Moshi environment...
  %PY% -m venv "%~dp0.moshi-env"
  if errorlevel 1 (
    echo ERROR: Could not create the Moshi Python environment.
    pause
    exit /b 1
  )
)

set "MOSHIPY=%~dp0.moshi-env\Scripts\python.exe"
set "PORT=8998"
set "LOG=%~dp0moshi-server.log"

echo.
echo Installing/updating Moshi...
"%MOSHIPY%" -m pip install --upgrade pip
if errorlevel 1 goto :pipfail
"%MOSHIPY%" -m pip install --upgrade moshi
if errorlevel 1 goto :pipfail

echo.
echo Starting Moshi server...
echo Server log: %LOG%
echo.
if exist "%LOG%" del /q "%LOG%" >nul 2>&1

start "Moshi Server" /min cmd /c ""%MOSHIPY%" -m moshi.server --hf-repo kyutai/moshika-pytorch-bf16 > "%LOG%" 2>&1"

echo Waiting for Moshi to start...
echo The first run may take several minutes while the model downloads.
echo.

set /a WAIT=0
:waitloop
timeout /t 2 /nobreak >nul
set /a WAIT+=2
powershell -NoProfile -Command "$r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/' -TimeoutSec 2 -ErrorAction SilentlyContinue; if($r -and $r.StatusCode -ge 200 -and $r.StatusCode -lt 500){exit 0}else{exit 1}"
if not errorlevel 1 goto :ready
if %WAIT% GEQ 600 goto :failed
goto :waitloop

:ready
echo.
echo ==========================================
echo MOSHI IS READY!
echo ==========================================
echo.
echo Opening http://127.0.0.1:%PORT%
echo Keep this launcher open while using Moshi.
echo.
start "" "http://127.0.0.1:%PORT%/"
goto :eof

:failed
echo.
echo ==========================================
echo MOSHI DID NOT START
echo ==========================================
echo.
echo Check this file for the actual error:
echo %LOG%
echo.
echo The browser was NOT opened because Moshi is not running.
echo.
pause
exit /b 1

:pipfail
echo.
echo ==========================================
echo MOSHI INSTALL FAILED
echo ==========================================
echo.
echo Check the messages above for the Python package error.
echo.
pause
exit /b 1
