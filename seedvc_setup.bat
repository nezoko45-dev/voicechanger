@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Seed-VC Setup

echo.
echo ==========================================
echo        Seed-VC Realtime Setup
echo ==========================================
echo.

set "ROOT=%~dp0"
set "SEED=%ROOT%Seed-VC-Realtime"
set "VENV=%SEED%\venv"

where py >nul 2>&1
if errorlevel 1 (
    echo Python launcher was not found.
    echo Installing Python 3.10 with winget...
    winget install --id Python.Python.3.10 -e --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
        echo.
        echo ERROR: Python 3.10 could not be installed automatically.
        echo Install Python 3.10, then run this file again.
        pause
        exit /b 1
    )
)

py -3.10 --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Python 3.10 is not available yet.
    echo If Python was just installed, close this window and run setup again.
    pause
    exit /b 1
)

if not exist "%SEED%\real-time-gui.py" (
    echo Downloading the maintained Seed-VC realtime engine...
    set "ZIP=%TEMP%\seed-vc-realtime.zip"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/jiaheguo521/seed-vc-realtime/archive/refs/heads/main.zip' -OutFile $env:ZIP"
    if errorlevel 1 (
        echo ERROR: Could not download Seed-VC.
        pause
        exit /b 1
    )

    powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath $env:ZIP -DestinationPath $env:TEMP -Force; if (Test-Path '%SEED%') { Remove-Item '%SEED%' -Recurse -Force }; Move-Item (Join-Path $env:TEMP 'seed-vc-realtime-main') '%SEED%'"
    del /q "%ZIP%" >nul 2>&1
)

if not exist "%VENV%\Scripts\python.exe" (
    echo Creating Python 3.10 virtual environment...
    py -3.10 -m venv "%VENV%"
    if errorlevel 1 (
        echo ERROR: Could not create the virtual environment.
        pause
        exit /b 1
    )
)

call "%VENV%\Scripts\activate.bat"

echo.
echo Updating pip...
python -m pip install --upgrade pip setuptools wheel
if errorlevel 1 goto :pip_error

echo.
echo Installing Seed-VC dependencies...
pip install -r "%SEED%\requirements.txt"
if errorlevel 1 goto :pip_error

echo.
echo Installing/updating the CUDA PyTorch build...
pip install -U torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 goto :pip_error

echo.
echo ==========================================
echo Seed-VC setup completed.
echo ==========================================
echo.
echo Next: double-click seedvc_start.bat
echo The first launch will download the Seed-VC model.
echo.
pause
exit /b 0

:pip_error
echo.
echo ERROR: A Python dependency failed to install.
echo The console was left open so you can see the error above.
echo.
pause
exit /b 1
