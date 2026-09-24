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
echo This uses WAV files directly.
echo No ONNX voice-model picker.
echo No PTH converter.
echo No Python / FFmpeg / PyTorch install.
echo.
echo THIS WINDOW WILL STAY OPEN IF ANYTHING FAILS.
echo.

set "APPDIR=%~dp0voice_clone"
set "EXE=%APPDIR%\voice_clone.exe"
set "MODEL=%APPDIR%\checkpoints_v2\converter"
set "MODEL_CONFIG=%MODEL%\config.json"
set "MODEL_FILE=%MODEL%\checkpoint.pth"

if not exist "%APPDIR%" mkdir "%APPDIR%"

if not exist "%EXE%" goto INSTALL_EXE
if not exist "%MODEL_CONFIG%" goto INSTALL_MODEL
if not exist "%MODEL_FILE%" goto INSTALL_MODEL
goto SELECT_SOURCE

:INSTALL_EXE
echo [1/2] Downloading the latest native WAV voice-clone EXE...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='Continue';" ^
  "$r=Invoke-RestMethod 'https://api.github.com/repos/jingangdidi/voice_clone/releases/latest';" ^
  "$a=$r.assets | Where-Object { $_.name -match '\\.exe$' } | Select-Object -First 1;" ^
  "if(-not $a){throw 'No EXE was found in the latest release.'};" ^
  "Write-Host ('Asset: ' + $a.name); Write-Host ('Size: ' + [math]::Round($a.size/1MB,1) + ' MB');" ^
  "Invoke-WebRequest -Uri $a.browser_download_url -OutFile '%EXE%'"

if errorlevel 1 (
  echo.
  echo ==================================================
  echo             EXE DOWNLOAD FAILED
  echo ==================================================
  echo.
  pause
  exit /b 1
)

if not exist "%EXE%" (
  echo.
  echo ==================================================
  echo             EXE WAS NOT CREATED
  echo ==================================================
  echo.
  pause
  exit /b 1
)

:INSTALL_MODEL
echo.
echo [2/2] Checking the OpenVoice model...
echo.

if not exist "%MODEL%" mkdir "%MODEL%"

if not exist "%MODEL_CONFIG%" (
  echo Downloading model config...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri 'https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/main/converter/config.json?download=true' -OutFile '%MODEL_CONFIG%'"
  if errorlevel 1 goto MODEL_FAIL
)

if not exist "%MODEL_FILE%" (
  echo Downloading voice-conversion model...
  echo This is the one-time model download.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri 'https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/main/converter/checkpoint.pth?download=true' -OutFile '%MODEL_FILE%'"
  if errorlevel 1 goto MODEL_FAIL
)

if not exist "%MODEL_CONFIG%" goto MODEL_FAIL
if not exist "%MODEL_FILE%" goto MODEL_FAIL
goto SELECT_SOURCE

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

:SELECT_SOURCE
echo.
echo ==================================================
echo STEP 1: SELECT SOURCE WAV
echo ==================================================
echo.
echo Source WAV = the recording whose words/content are kept.
echo.

set "SOURCE="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select SOURCE WAV'; $d.Filter='WAV audio (*.wav)|*.wav'; if($d.ShowDialog() -eq 'OK'){[Console]::WriteLine($d.FileName)}"`) do set "SOURCE=%%A"

if not defined SOURCE (
  echo.
  echo No source WAV selected.
  pause
  exit /b 0
)

echo.
echo ==================================================
echo STEP 2: SELECT TARGET WAV
echo ==================================================
echo.
echo Target WAV = the voice/tone color to copy.
echo.

set "TARGET="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select TARGET WAV - voice to copy'; $d.Filter='WAV audio (*.wav)|*.wav'; if($d.ShowDialog() -eq 'OK'){[Console]::WriteLine($d.FileName)}"`) do set "TARGET=%%A"

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
echo                 READY TO CONVERT
echo ==================================================
echo.
echo Source: "%SOURCE%"
echo Target: "%TARGET%"
echo Output: "%OUTPUT%"
echo.
echo Starting native WAV voice cloning...
echo.
echo The window stays open until the conversion is done.
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
