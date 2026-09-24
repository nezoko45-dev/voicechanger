@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Simple WAV Voice Converter
cd /d "%~dp0"

echo.
echo ==================================================
echo              SIMPLE WAV VOICE CONVERTER
echo ==================================================
echo.
echo ONE WAV FILE ONLY
echo.
echo Select one WAV and the app will process that WAV
echo directly through the native voice-conversion engine.
echo.
echo No second WAV is required.
echo No ONNX voice-model picker.
echo No model converter.
echo.
echo NOTE: With only one WAV, there is no separate target
echo voice. The same WAV is used as the source and reference.
echo ==================================================
echo.

set "APPDIR=%~dp0voice_clone"
set "EXE=%APPDIR%\voice_clone.exe"
set "MODEL=%APPDIR%\checkpoints_v2\converter"
set "MODEL_CONFIG=%MODEL%\config.json"
set "MODEL_FILE=%MODEL%\checkpoint.pth"
set "EXE_URL=https://github.com/jingangdidi/voice_clone/releases/download/v0.1.2/voice_clone_simple-vad_cpu_windows_x86-64.exe"
set "MODEL_URL=https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/main/converter/checkpoint.pth?download=true"
set "CONFIG_URL=https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/main/converter/config.json?download=true"

if not exist "%APPDIR%" mkdir "%APPDIR%"

if not exist "%EXE%" (
  echo [1/3] Downloading native WAV engine...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri '%EXE_URL%' -OutFile '%EXE%'"
  if errorlevel 1 (
    echo.
    echo EXE DOWNLOAD FAILED.
    echo The window is staying open so you can see the error.
    echo.
    pause
    exit /b 1
  )
)

if not exist "%EXE%" (
  echo.
  echo ERROR: voice_clone.exe was not created.
  pause
  exit /b 1
)

if not exist "%MODEL_CONFIG%" (
  echo.
  echo [2/3] Downloading model config...
  echo.
  if not exist "%MODEL%" mkdir "%MODEL%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri '%CONFIG_URL%' -OutFile '%MODEL_CONFIG%'"
  if errorlevel 1 goto MODEL_FAIL
)

if not exist "%MODEL_FILE%" (
  echo.
  echo [3/3] Downloading voice-conversion model...
  echo This is a one-time download.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri '%MODEL_URL%' -OutFile '%MODEL_FILE%'"
  if errorlevel 1 goto MODEL_FAIL
)

if not exist "%MODEL_CONFIG%" goto MODEL_FAIL
if not exist "%MODEL_FILE%" goto MODEL_FAIL

echo.
echo ==================================================
echo STEP 1: SELECT ONE WAV FILE
echo ==================================================
echo.
echo Pick any WAV file.
echo.

set "INPUT="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select one WAV file'; $d.Filter='WAV audio (*.wav)|*.wav|All files (*.*)|*.*'; if($d.ShowDialog() -eq 'OK'){[Console]::WriteLine($d.FileName)}"`) do set "INPUT=%%A"

if not defined INPUT (
  echo.
  echo No WAV selected.
  pause
  exit /b 0
)

for %%F in ("%INPUT%") do (
  set "OUTDIR=%%~dpF"
  set "BASENAME=%%~nF"
)

set "OUTPUT=%OUTDIR%%BASENAME%_converted.wav"

echo.
echo ==================================================
echo READY
echo ==================================================
echo.
echo Input : "%INPUT%"
echo Output: "%OUTPUT%"
echo.
echo Processing the single WAV now...
echo.
echo Please keep this window open.
echo.

pushd "%APPDIR%"
"%EXE%" -s "%INPUT%" -t "%INPUT%" -m "%MODEL%" -T 0 -o "%OUTDIR%" -n "%BASENAME%_converted.wav"
set "RESULT=%ERRORLEVEL%"
popd

echo.
if not "%RESULT%"=="0" (
  echo ==================================================
  echo               CONVERSION FAILED
  echo ==================================================
  echo.
  echo Exit code: %RESULT%
  echo.
  pause
  exit /b %RESULT%
)

if not exist "%OUTPUT%" (
  echo ==================================================
  echo          OUTPUT WAV WAS NOT CREATED
  echo ==================================================
  echo.
  echo Expected:
  echo "%OUTPUT%"
  echo.
  pause
  exit /b 1
)

echo ==================================================
echo             CONVERSION COMPLETE
echo ==================================================
echo.
echo Output WAV:
echo "%OUTPUT%"
echo.
pause
exit /b 0

:MODEL_FAIL
echo.
echo ==================================================
echo             MODEL DOWNLOAD FAILED
echo ==================================================
echo.
echo Run this batch again to retry.
echo.
pause
exit /b 1
