@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Simple WAV Voice Changer
cd /d "%~dp0"

echo.
echo ==================================================
echo             SIMPLE WAV VOICE CHANGER
echo ==================================================
echo.
echo ONE WAV FILE -> BUILT-IN TARGET VOICE
echo.
echo Select ONE WAV file.
echo Built-in target voice: EN-DEFAULT
echo.
echo No second WAV.
echo No ONNX voice model.
echo No model converter.
echo.
echo ==================================================
echo.

set "APPDIR=%~dp0voice_clone"
set "EXE=%APPDIR%\voice_clone.exe"
set "MODELROOT=%APPDIR%\checkpoints_v2"
set "MODELDIR=%MODELROOT%\converter"
set "MODELFILE=%MODELDIR%\checkpoint.pth"
set "EXE_URL=https://github.com/jingangdidi/voice_clone/releases/download/v0.1.2/voice_clone_simple-vad_cpu_windows_x86-64.exe"
set "MODELZIP_URL=https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip"
set "MODELZIP=%TEMP%\openvoice_checkpoints_v2.zip"

if not exist "%APPDIR%" mkdir "%APPDIR%"

if not exist "%EXE%" (
  echo [1/2] Downloading the native WAV voice engine...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri '%EXE_URL%' -OutFile '%EXE%'"
  if errorlevel 1 (
    echo.
    echo ==================================================
    echo             ENGINE DOWNLOAD FAILED
    echo ==================================================
    echo.
    pause
    exit /b 1
  )
)

if not exist "%EXE%" (
  echo.
  echo ERROR: voice_clone.exe was not created.
  echo.
  pause
  exit /b 1
)

if not exist "%MODELFILE%" (
  echo.
  echo [2/2] Downloading the built-in voice model...
  echo.
  echo One-time download. Please wait.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri '%MODELZIP_URL%' -OutFile '%MODELZIP%'"
  if errorlevel 1 goto MODEL_FAIL
  if not exist "%MODELZIP%" goto MODEL_FAIL

  echo.
  echo Extracting the model...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Expand-Archive -LiteralPath '%MODELZIP%' -DestinationPath '%APPDIR%' -Force"
  if errorlevel 1 goto MODEL_FAIL
  del /q "%MODELZIP%" >nul 2>&1
)

if not exist "%MODELFILE%" goto MODEL_FAIL

echo.
echo ==================================================
echo SELECT ONE WAV FILE
echo ==================================================
echo.
echo The WAV will be changed to the built-in EN-DEFAULT voice.
echo.

set "INPUT="
for /f "usebackq delims=" %%A in ('powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title=''Select one WAV file''; $d.Filter=''WAV audio (*.wav)|*.wav|All files (*.*)|*.*''; $d.Multiselect=$false; if($d.ShowDialog() -eq ''OK''){[Console]::WriteLine($d.FileName)}"') do set "INPUT=%%A"

if not defined INPUT (
  echo.
  echo No WAV selected.
  echo.
  pause
  exit /b 0
)

for %%F in ("%INPUT%") do (
  set "OUTDIR=%%~dpF"
  set "BASENAME=%%~nF"
)

set "OUTPUT=%OUTDIR%%BASENAME%_voicechanged.wav"

echo.
echo ==================================================
echo                 VOICE CONVERSION
echo ==================================================
echo.
echo Input : "%INPUT%"
echo Target: EN-DEFAULT
echo Output: "%OUTPUT%"
echo.
echo Starting conversion...
echo Please keep this window open.
echo.

pushd "%APPDIR%"
"%EXE%" -s "%INPUT%" -t en-default -T 0 -o "%OUTDIR%" -n "%BASENAME%_voicechanged.wav"
set "RESULT=%ERRORLEVEL%"
popd

echo.
if not "%RESULT%"=="0" (
  echo ==================================================
  echo             VOICE CONVERSION FAILED
  echo ==================================================
  echo.
  echo Exit code: %RESULT%
  echo.
  echo The engine error is shown above.
  echo.
  pause
  exit /b %RESULT%
)

if not exist "%OUTPUT%" (
  echo ==================================================
  echo             OUTPUT WAS NOT CREATED
  echo ==================================================
  echo.
  echo Expected:
  echo "%OUTPUT%"
  echo.
  pause
  exit /b 1
)

echo ==================================================
echo            VOICE CONVERSION COMPLETE
echo ==================================================
echo.
echo Converted WAV:
echo "%OUTPUT%"
echo.
pause
exit /b 0

:MODEL_FAIL
echo.
echo ==================================================
echo             VOICE MODEL DOWNLOAD FAILED
echo ==================================================
echo.
echo The built-in model could not be downloaded or extracted.
echo Run this batch again to retry.
echo.
pause
exit /b 1
