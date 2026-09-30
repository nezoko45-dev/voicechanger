@echo off
setlocal
cd /d "%~dp0"
set "PIPER_DIR=%~dp0runtime"
set "PIPER_EXE=%PIPER_DIR%\piper\piper.exe"
set "VOICE_DIR=%PIPER_DIR%\voices"
set "VOICE=%VOICE_DIR%\en_US-amy-medium.onnx"

if not exist "%PIPER_EXE%" (
  echo Downloading Piper Windows x64...
  if not exist "%PIPER_DIR%" mkdir "%PIPER_DIR%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip' -OutFile '%PIPER_DIR%\piper.zip'"
  if errorlevel 1 goto :fail
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force '%PIPER_DIR%\piper.zip' '%PIPER_DIR%\piper_extract'"
  if errorlevel 1 goto :fail
  if exist "%PIPER_DIR%\piper_extract\piper\piper.exe" (
    move /Y "%PIPER_DIR%\piper_extract\piper\*" "%PIPER_DIR%\piper\" >nul
  ) else (
    if not exist "%PIPER_DIR%\piper" mkdir "%PIPER_DIR%\piper"
    move /Y "%PIPER_DIR%\piper_extract\*" "%PIPER_DIR%\piper\" >nul
  )
  rmdir /S /Q "%PIPER_DIR%\piper_extract" 2>nul
  del "%PIPER_DIR%\piper.zip" 2>nul
)

if not exist "%PIPER_EXE%" goto :fail
if not exist "%VOICE_DIR%" mkdir "%VOICE_DIR%"

if not exist "%VOICE%" (
  echo Downloading Amy female voice (~63 MB)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx?download=true' -OutFile '%VOICE%'"
  if errorlevel 1 goto :fail
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json?download=true' -OutFile '%VOICE%.json'"
  if errorlevel 1 goto :fail
)

if not exist "%VOICE%.json" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json?download=true' -OutFile '%VOICE%.json'"
)

echo.
echo Piper is ready: Amy female voice.
echo Starting local bridge at http://127.0.0.1:8100
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0piper_bridge.ps1" -PiperExe "%PIPER_EXE%" -Model "%VOICE%"
exit /b 0

:fail
echo.
echo Piper setup failed. Check your internet connection and try again.
pause
exit /b 1
