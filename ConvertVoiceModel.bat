@echo off
setlocal EnableExtensions
title RVC Model Converter
cd /d "%~dp0"

echo.
echo ================================================
echo             RVC MODEL CONVERTER
echo ================================================
echo.
echo   [1] Convert supported .PTH model to .ONNX
echo   [2] Open voice changer
echo   [3] Exit
echo.
choice /c 123 /n /m "Choose an option: "

if errorlevel 3 exit /b 0
if errorlevel 2 goto VOICE
if errorlevel 1 goto CONVERT

:CONVERT
echo.
echo ================================================
echo        CONVERT RVC MODEL TO ONNX
echo ================================================
echo.
echo The native vc-rs GUI will open now.
echo Choose your RVC .pth file in its model Browse/drop area.
echo.
echo The built-in converter supports RVC v2 / F0 PTH models.
echo.
if not exist "%~dp0vc-rs\vc-gui.exe" (
    echo vc-gui.exe is not installed yet.
    echo Run VoiceChanger.bat first.
    pause
    exit /b 1
)
start "" "%~dp0vc-rs\vc-gui.exe"
pause
exit /b 0

:VOICE
if not exist "%~dp0vc-rs\vc-gui.exe" (
    echo vc-gui.exe is not installed yet.
    echo Run VoiceChanger.bat first.
    pause
    exit /b 1
)
start "" "%~dp0vc-rs\vc-gui.exe"
exit /b 0
