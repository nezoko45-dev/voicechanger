@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Seed-VC Real-Time Voice Changer

set "ROOT=%~dp0"
set "SEED=%ROOT%seed-vc"
set "PY=%ROOT%.venv\Scripts\python.exe"
set "INBOX=%ROOT%clone_input"
set "ZIP=%ROOT%seed-vc.zip"
set "URL=https://github.com/jiaheguo521/seed-vc-realtime/archive/refs/heads/main.zip"

if not exist "%INBOX%" mkdir "%INBOX%"

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
echo [3/5] Checking Seed-VC files...
if not exist "%SEED%\real-time-gui.py" (
  echo Seed-VC is not installed yet.
  echo Downloading from GitHub...
  echo This download can take a few minutes. Please wait.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -OutFile '%ZIP%'"
  if errorlevel 1 (
    echo ERROR: Seed-VC download failed.
    pause
    exit /b 1
  )
  echo Extracting Seed-VC...
  if exist "%SEED%" rmdir /s /q "%SEED%"
  if exist "%ROOT%seed_extract" rmdir /s /q "%ROOT%seed_extract"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force '%ZIP%' '%ROOT%seed_extract'; Move-Item -Force '%ROOT%seed_extract\seed-vc-realtime-main' '%SEED%'; Remove-Item -Recurse -Force '%ROOT%seed_extract'"
  if errorlevel 1 (
    echo ERROR: Seed-VC extraction failed.
    pause
    exit /b 1
  )
) else (
  echo Seed-VC files found.
)

echo.
echo [4/5] Installing dependencies...
echo First-time installation may take several minutes.
"%PY%" -m pip install --disable-pip-version-check --upgrade pip
if errorlevel 1 goto PIPFAIL
"%PY%" -m pip install --disable-pip-version-check -r "%ROOT%requirements-seedvc.txt"
if errorlevel 1 goto PIPFAIL

echo.
echo [5/5] Starting Seed-VC...
echo.
echo Chrome controller will open now.
start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ROOT%index.html"
if errorlevel 1 start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%ROOT%index.html"

cd /d "%SEED%"
echo Launching real-time voice conversion...
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

:PIPFAIL
echo.
echo ERROR: Dependency installation failed.
echo The window was not supposed to look frozen.
echo Run start.bat again after checking the error above.
pause
exit /b 1
