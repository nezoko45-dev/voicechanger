@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Seed-VC Real-Time Voice Changer

set "ROOT=%~dp0"
set "SEED=%ROOT%seed-vc"
set "PY=%ROOT%.venv\Scripts\python.exe"
set "INBOX=%ROOT%clone_input"
set "ZIP=%ROOT%seed-vc.zip"
set "URL=https://github.com/Plachtaa/seed-vc/archive/refs/heads/main.zip"

if not exist "%INBOX%" mkdir "%INBOX%"

echo ========================================
echo        Seed-VC Voice Changer
echo ========================================
echo.

where py >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python launcher was not found.
  echo Install Python 3.10 from python.org, then run this again.
  pause
  exit /b 1
)

if not exist "%PY%" (
  echo Creating Python 3.10 environment...
  py -3.10 -m venv "%ROOT%.venv"
  if errorlevel 1 (
    echo.
    echo ERROR: Python 3.10 was not found.
    echo Seed-VC recommends Python 3.10 on Windows.
    pause
    exit /b 1
  )
)

if not exist "%SEED%\real-time-gui.py" (
  echo Downloading Seed-VC...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -OutFile '%ZIP%'"
  if errorlevel 1 (
    echo ERROR: Seed-VC download failed.
    pause
    exit /b 1
  )
  if exist "%SEED%" rmdir /s /q "%SEED%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force '%ZIP%' '%ROOT%seed_extract'; Move-Item -Force '%ROOT%seed_extract\seed-vc-main' '%SEED%'; Remove-Item -Recurse -Force '%ROOT%seed_extract'"
  if errorlevel 1 (
    echo ERROR: Could not extract Seed-VC.
    pause
    exit /b 1
  )
)

echo.
echo Installing Seed-VC dependencies...
"%PY%" -m pip install --disable-pip-version-check --upgrade pip
"%PY%" -m pip install --disable-pip-version-check torch==2.4.0 torchvision==0.19.0 torchaudio==2.4.0
"%PY%" -m pip install --disable-pip-version-check -r "%ROOT%requirements-seedvc.txt"
if errorlevel 1 (
  echo.
  echo ERROR: Seed-VC dependencies failed.
  pause
  exit /b 1
)

echo.
echo Opening Chrome controller...
start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ROOT%index.html"
if errorlevel 1 start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%ROOT%index.html"

echo.
echo Starting Seed-VC real-time converter...
echo.
cd /d "%SEED%"
"%PY%" real-time-gui.py
pause
