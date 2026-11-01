@echo off
setlocal EnableExtensions
title Chatterbox Voice Cloning + Continuous Dictation
cd /d "%~dp0"

set "APPDIR=%~dp0"
set "VENV=%~dp0.venv"
set "VPY=%VENV%\Scripts\python.exe"
set "APP_URL=https://nezoko45-dev.github.io/voicechanger/chatterbox-test/"
set "PYTHON="
set "SERVER_LOG=%~dp0chatterbox-server.log"
set "SETUP_LOG=%~dp0chatterbox-setup.log"

echo.
echo  ==================================================
echo     CHATTERBOX - VOICE CLONING + LIVE DICTATION
echo  ==================================================
echo.
echo This window will remain open. Startup details are saved beside this BAT file.
echo.

echo [1/5] Checking Python 3.11...
where py >nul 2>nul
if not errorlevel 1 (
  py -3.11 --version >nul 2>nul
  if not errorlevel 1 set "PYTHON=py -3.11"
)
if not defined PYTHON (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,11) else 1)" >nul 2>nul
    if not errorlevel 1 set "PYTHON=python"
  )
)
if not defined PYTHON (
  echo [ERROR] Python 3.11 was not found.
  echo Install Python 3.11 x64 from https://www.python.org/downloads/
  echo Then run this file again.
  goto :keep_open
)
echo [OK] Python 3.11 found.

echo.
echo [2/5] Checking the isolated environment...
if not exist "%VPY%" (
  %PYTHON% -m venv "%VENV%" >>"%SETUP_LOG%" 2>&1
  if errorlevel 1 (
    echo [ERROR] Could not create the virtual environment.
    goto :show_setup_log
  )
)
"%VPY%" -m pip --version >nul 2>nul
if errorlevel 1 (
  "%VPY%" -m ensurepip --upgrade >>"%SETUP_LOG%" 2>&1
  if errorlevel 1 (
    echo [ERROR] Python pip could not be initialized.
    goto :show_setup_log
  )
)

echo.
echo [3/5] Checking Chatterbox dependencies...
"%VPY%" -c "import chatterbox, fastapi, uvicorn, multipart, torchaudio" >nul 2>nul
if errorlevel 1 (
  echo [SETUP] Installing packages. This can take several minutes.
  echo [SETUP] Full installation log: "%SETUP_LOG%"
  "%VPY%" -m pip install --upgrade pip >>"%SETUP_LOG%" 2>&1
  if errorlevel 1 (
    echo [ERROR] pip upgrade failed.
    goto :show_setup_log
  )
  "%VPY%" -m pip install -r "%APPDIR%requirements.txt" >>"%SETUP_LOG%" 2>&1
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed.
    goto :show_setup_log
  )
) else (
  echo [OK] Chatterbox dependencies are ready.
)

echo.
echo [4/5] Checking the local engine...
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/status' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo [OK] Local engine is already running.
) else (
  if exist "%SERVER_LOG%" del "%SERVER_LOG%" >nul 2>nul
  echo [START] Launching local engine. Log: "%SERVER_LOG%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$p=Start-Process -FilePath $env:VPY -ArgumentList @('-u', ('"{0}"' -f (Join-Path $env:APPDIR 'server.py'))) -WorkingDirectory $env:APPDIR -WindowStyle Hidden -RedirectStandardOutput $env:SERVER_LOG -RedirectStandardError ($env:SERVER_LOG + '.err') -PassThru; Set-Content -Path (Join-Path $env:APPDIR 'chatterbox-server.pid') -Value $p.Id"
  if errorlevel 1 (
    echo [ERROR] Windows could not launch the local engine.
    goto :keep_open
  )
  echo [WAIT] Waiting up to 45 seconds for the local API...
  powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 60;$i++){try{$r=Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/status' -TimeoutSec 2;$ok=$true;break}catch{Start-Sleep -Milliseconds 750}}; if($ok){exit 0}else{exit 1}"
  if errorlevel 1 (
    echo [ERROR] The local engine did not become ready.
    echo See chatterbox-server.log and chatterbox-server.log.err beside this BAT file.
    goto :show_server_log
  )
)
echo [OK] Local API is responding.

echo.
echo [5/5] Opening the app...
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if defined CHROME (
  start "" "%CHROME%" "%APP_URL%"
) else (
  start "" "%APP_URL%"
)

echo.
echo [READY] Chatterbox local API is running.
echo Use the app to upload a reference WAV and generate cloned speech.
echo Continuous dictation requires Chrome microphone permission and internet.
echo.
echo This launcher window will stay open. Press any key only when you want to close it.
goto :keep_open

:show_setup_log
echo.
echo ---------------- SETUP LOG ----------------
if exist "%SETUP_LOG%" type "%SETUP_LOG%"
echo --------------------------------------------
goto :keep_open

:show_server_log
echo.
echo ---------------- SERVER LOG ----------------
if exist "%SERVER_LOG%" type "%SERVER_LOG%"
if exist "%SERVER_LOG%.err" type "%SERVER_LOG%.err"
echo --------------------------------------------
goto :keep_open

:keep_open
echo.
echo Chatterbox launcher stopped here so the error is not lost.
echo Log files are saved in: "%APPDIR%"
echo.
pause
exit /b
