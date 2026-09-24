@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Simple WAV Voice Cloner
cd /d "%~dp0"

echo.
echo ==================================================
echo              SIMPLE WAV VOICE CLONER
echo ==================================================
echo.
echo WAV source -> WAV target voice -> WAV output
echo.
echo Direct WAV input. No ONNX voice model is used.
echo No model converter is used.
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
  echo ==================================================
  echo STEP 1: DOWNLOADING WAV CLONER
  echo ==================================================
  echo.
  echo Downloading the native Windows WAV cloner...
  echo.

  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri '%EXE_URL%' -OutFile '%EXE%'"

  if errorlevel 1 (
    echo.
    echo ==================================================
    echo EXE DOWNLOAD FAILED
    echo ==================================================
    echo.
    echo The download command failed. The exact error is above.
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

if not exist "%MODEL_CONFIG%" (
  echo.
  echo ==================================================
  echo STEP 2: DOWNLOADING MODEL CONFIG
  echo ==================================================
  echo.

  if not exist "%MODEL%" mkdir "%MODEL%"

  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri '%CONFIG_URL%' -OutFile '%MODEL_CONFIG%'"

  if errorlevel 1 goto MODEL_FAIL
)

if not exist "%MODEL_FILE%" (
  echo.
  echo ==================================================
  echo STEP 3: DOWNLOADING VOICE MODEL
  echo ==================================================
  echo.
  echo This is the larger one-time download.
  echo.

  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri '%MODEL_URL%' -OutFile '%MODEL_FILE%'"

  if errorlevel 1 goto MODEL_FAIL
)

if not exist "%MODEL_CONFIG%" goto MODEL_FAIL
if not exist "%MODEL_FILE%" goto MODEL_FAIL

echo.
echo ==================================================
echo STEP 4: SELECT SOURCE WAV
echo ==================================================
echo.
echo Select the WAV whose spoken words/content you want to keep.
echo.

set "SOURCE="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select SOURCE WAV'; $d.Filter='WAV audio (*.wav)|*.wav|All files (*.*)|*.*'; if($d.ShowDialog() -eq 'OK'){[Console]::WriteLine($d.FileName)}"`) do set "SOURCE=%%A"

if not defined SOURCE (
  echo.
  echo No source WAV selected.
  pause
  exit /b 0
)

echo.
echo ==================================================
echo STEP 5: SELECT TARGET WAV
echo ==================================================
echo.
echo Select the WAV whose voice you want to copy.
echo.

set "TARGET="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select TARGET WAV - voice to copy'; $d.Filter='WAV audio (*.wav)|*.wav|All files (*.*)|*.*'; if($d.ShowDialog() -eq 'OK'){[Console]::WriteLine($d.FileName)}"`) do set "TARGET=%%A"

if not defined TARGET (
  echo.
  echo No target WAV selected.
  pause
  exit /b 0
)

for %%F in ("%SOURCE%") do (
  set "OUTDIR=%%~dpF"
  set "BASENAME=%%~nF"
)

set "OUTPUT=%OUTDIR%%BASENAME%_voiceclone.wav"

echo.
echo ==================================================
echo                CONVERSION RUNNING
echo ==================================================
echo.
echo Source: "%SOURCE%"
echo Target: "%TARGET%"
echo Output: "%OUTPUT%"
echo.
echo Please keep this window open.
echo The native converter can take a while on CPU.
echo.

pushd "%APPDIR%"
"%EXE%" -s "%SOURCE%" -t "%TARGET%" -m "%MODEL%" -T 0 -o "%OUTDIR%" -n "%BASENAME%_voiceclone.wav"
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
  echo The converter error is shown above.
  echo.
  pause
  exit /b %RESULT%
)

if not exist "%OUTPUT%" (
  echo ==================================================
  echo          NO OUTPUT WAV WAS CREATED
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
echo Converted WAV:
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
echo The OpenVoice model files were not downloaded.
echo Run this batch again to retry.
echo.
pause
exit /b 1
