@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Simple WAV Voice Changer
cd /d "%~dp0"

echo.
echo ==================================================
echo             SIMPLE WAV VOICE CHANGER
echo ==================================================
echo.
echo SELECT ONE REFERENCE WAV
echo.
echo The batch automatically finds the SOURCE WAV.
echo.
echo SOURCE priority:
echo   converted.wav
echo   input.wav
echo   source.wav
echo   recording.wav
echo   otherwise: first other WAV in this folder
echo.
echo The selected reference WAV supplies the target voice.
echo The automatically found WAV supplies the words/audio.
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
  echo Downloading the native WAV voice engine...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri '%EXE_URL%' -OutFile '%EXE%'"
  if errorlevel 1 (
    echo.
    echo ENGINE DOWNLOAD FAILED.
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
  echo Downloading the OpenVoice model...
  echo This is a one-time download.
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
echo SELECT ONE REFERENCE WAV
echo ==================================================
echo.
echo This WAV becomes the target voice.
echo.

set "REFERENCE="
for /f "usebackq delims=" %%A in ('powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title=''Select REFERENCE WAV - target voice''; $d.Filter=''WAV audio (*.wav)|*.wav|All files (*.*)|*.*''; if($d.ShowDialog() -eq ''OK''){[Console]::WriteLine($d.FileName)}"') do set "REFERENCE=%%A"

if not defined REFERENCE (
  echo.
  echo No reference WAV selected.
  echo.
  pause
  exit /b 0
)

for %%F in ("%REFERENCE%") do set "REFDIR=%%~dpF"

set "SOURCE="

for %%N in (converted.wav input.wav source.wav recording.wav) do (
  if not defined SOURCE if exist "%REFDIR%%%N" if /i not "%REFDIR%%%N"=="%REFERENCE%" set "SOURCE=%REFDIR%%%N"
)

if not defined SOURCE (
  for /f "delims=" %%A in ('powershell -NoProfile -Command "Get-ChildItem -LiteralPath ''%REFDIR%'' -Filter *.wav -File | Where-Object { $_.FullName -ne ''%REFERENCE%'' -and $_.Name -notlike ''*_voicechanged.wav'' -and $_.Name -notlike ''*_converted.wav'' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"') do set "SOURCE=%%A"
)

if not defined SOURCE (
  echo.
  echo No separate source WAV was found.
  echo.
  echo Using the REFERENCE WAV itself as the source.
  echo This automatically creates a same-voice WAV from the reference.
  echo.
  set "SOURCE=%REFERENCE%"
)

for %%F in ("%SOURCE%") do (
  set "OUTDIR=%%~dpF"
  set "BASENAME=%%~nF"
)

set "OUTPUT=%OUTDIR%%BASENAME%_voicechanged.wav"

echo.
echo ==================================================
echo                 VOICE CONVERSION
echo ==================================================
echo.
echo Reference: "%REFERENCE%"
echo Source   : "%SOURCE%"
echo Output   : "%OUTPUT%"
echo.
echo Converting source audio into the reference voice...
echo.
echo Please keep this window open.
echo.

pushd "%APPDIR%"
"%EXE%" -s "%SOURCE%" -t "%REFERENCE%" -T 0 -o "%OUTDIR%" -n "%BASENAME%_voicechanged.wav"
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
  echo.
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
echo Run this batch again to retry.
echo.
pause
exit /b 1
