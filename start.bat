@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Seed-VC Real-Time Voice Changer

set "ROOT=%~dp0"
set "SEED=%ROOT%seed-vc"
set "PY=%ROOT%.venv\Scripts\python.exe"
set "INBOX=%ROOT%clone_input"
set "MODELS=%ROOT%models"
set "OUTPUT=%ROOT%output"
set "ZIP=%ROOT%seed-vc.zip"
set "URL=https://github.com/jiaheguo521/seed-vc-realtime/archive/refs/heads/main.zip"

if not exist "%INBOX%" mkdir "%INBOX%"
if not exist "%MODELS%" mkdir "%MODELS%"
if not exist "%OUTPUT%" mkdir "%OUTPUT%"

echo ========================================
echo       Seed-VC Real-Time Setup
echo ========================================
echo.
echo [1/5] Checking Python 3.10...
where py >nul 2>nul
if errorlevel 1 goto PYFAIL
if not exist "%PY%" (
  echo [2/5] Creating Python 3.10 environment...
  py -3.10 -m venv "%ROOT%.venv"
  if errorlevel 1 goto PYFAIL
) else (
  echo [2/5] Python environment already exists.
)

echo.
echo [3/5] Checking Seed-VC source files...
if not exist "%SEED%\real-time-gui.py" goto DOWNLOAD_SEED
if not exist "%SEED%\realtime_vc_engine.py" goto DOWNLOAD_SEED
if not exist "%SEED%\audio_modules" goto DOWNLOAD_SEED
if not exist "%SEED%\configs\config.json" goto DOWNLOAD_SEED
echo Seed-VC source is complete.
goto INSTALL

:DOWNLOAD_SEED
echo Seed-VC source is missing or incomplete.
echo Downloading the complete real-time package from GitHub...
echo This may take a few minutes. Please wait.
if exist "%ZIP%" del /q "%ZIP%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -OutFile '%ZIP%'"
if errorlevel 1 goto DOWNLOADFAIL
if exist "%SEED%" rmdir /s /q "%SEED%"
if exist "%ROOT%seed_extract" rmdir /s /q "%ROOT%seed_extract"
echo Extracting Seed-VC...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force '%ZIP%' '%ROOT%seed_extract'; Move-Item -Force '%ROOT%seed_extract\seed-vc-realtime-main' '%SEED%'; Remove-Item -Recurse -Force '%ROOT%seed_extract'"
if errorlevel 1 goto EXTRACTFAIL
if not exist "%SEED%\real-time-gui.py" goto SEEDFAIL
if not exist "%SEED%\realtime_vc_engine.py" goto SEEDFAIL
if not exist "%SEED%\audio_modules" goto SEEDFAIL
if not exist "%SEED%\configs\config.json" goto SEEDFAIL
echo Seed-VC source installed successfully.

:INSTALL
echo.
echo [4/5] Installing dependencies...
echo First-time installation may take several minutes.
"%PY%" -m pip install --disable-pip-version-check --upgrade pip
if errorlevel 1 goto PIPFAIL
"%PY%" -m pip install --disable-pip-version-check -r "%ROOT%requirements-seedvc.txt"
if errorlevel 1 goto PIPFAIL

echo.
echo [5/5] Starting Seed-VC...
echo Opening the reference-voice folder...
start "" explorer.exe "%INBOX%"
echo Launching Seed-VC real-time GUI...
cd /d "%SEED%"
"%PY%" real-time-gui.py
if errorlevel 1 (
  echo.
  echo Seed-VC exited with an error.
  echo Check the message above.
)
pause
exit /b 0

:PYFAIL
echo.
echo ERROR: Python 3.10 is required.
echo Install Python 3.10 and run start.bat again.
pause
exit /b 1

:DOWNLOADFAIL
echo.
echo ERROR: Seed-VC download failed.
echo Check your internet connection and run start.bat again.
pause
exit /b 1

:EXTRACTFAIL
echo.
echo ERROR: Seed-VC extraction failed.
echo Delete seed-vc.zip and run start.bat again.
pause
exit /b 1

:SEEDFAIL
echo.
echo ERROR: Seed-VC source is still incomplete.
echo Delete seed-vc.zip and run start.bat again.
pause
exit /b 1

:PIPFAIL
echo.
echo ERROR: Dependency installation failed.
echo Check the package error above, then run start.bat again.
pause
exit /b 1
