@echo off
setlocal
cd /d "%~dp0"
if not exist tts_app.exe call build.bat
if not exist tts_app.exe exit /b 1
if not exist models\ggml-tiny.en.bin call setup_models.bat

echo.
tts_app.exe
pause
