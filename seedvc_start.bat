@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Seed-VC Realtime Voice Changer

set "SEED=%~dp0Seed-VC-Realtime"
set "VENV=%SEED%\venv"

if not exist "%SEED%\real-time-gui.py" (
    echo Seed-VC is not installed yet.
    echo.
    echo Run seedvc_setup.bat first.
    pause
    exit /b 1
)

if not exist "%VENV%\Scripts\python.exe" (
    echo Seed-VC virtual environment is missing.
    echo.
    echo Run seedvc_setup.bat first.
    pause
    exit /b 1
)

call "%VENV%\Scripts\activate.bat"

echo.
echo Starting Seed-VC realtime voice conversion...
echo.
echo IMPORTANT:
echo   - Choose your reference WAV in the Seed-VC window.
echo   - Choose your microphone as Input Device.
echo   - Choose your desired Windows/Voicemeeter output.
echo   - Start Voice Conversion.
echo.
echo The first run may download the model from Hugging Face.
echo.

cd /d "%SEED%"
python real-time-gui.py --fp16 true --gpu 0

echo.
echo Seed-VC has stopped.
pause
