@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Simple WAV Voice Cloner
cd /d "%~dp0"

set "APPDIR=%~dp0voice_clone"
set "EXE=%APPDIR%\voice_clone_simple-vad_cpu_windows_x86-64.exe"
set "MODEL=%APPDIR%\checkpoints_v2\converter"
set "MODEL_CONFIG=%MODEL%\config.json"
set "MODEL_FILE=%MODEL%\checkpoint.pth"

echo.
echo ==================================================
echo              SIMPLE WAV VOICE CLONER
echo ==================================================
echo.
echo WAV in -> WAV out
echo.
echo No ONNX voice model is needed.
echo No PTH-to-ONNX conversion is used.
echo No Python, FFmpeg, or PyTorch install is required.
echo.
echo Choose:
echo   1. SOURCE WAV = the audio you want to change
echo   2. TARGET WAV = the voice you want to copy
echo.
echo The finished WAV is saved beside the source WAV.
echo.

if not exist "%EXE%" goto INSTALL_EXE
if not exist "%MODEL_CONFIG%" goto INSTALL_MODEL
if not exist "%MODEL_FILE%" goto INSTALL_MODEL
goto SELECT_SOURCE

:INSTALL_EXE
echo [1/3] Downloading the small native WAV voice-clone EXE...
echo.
if not exist "%APPDIR%" mkdir "%APPDIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='Continue'; Start-BitsTransfer -Source 'https://github.com/jingangdidi/voice_clone/releases/download/v0.1.2/voice_clone_simple-vad_cpu_windows_x86-64.exe' -Destination '%EXE%' -DisplayName 'Downloading WAV voice cloner'"

if errorlevel 1 (
  echo.
  echo EXE DOWNLOAD FAILED.
  pause
  exit /b 1
)

if not exist "%EXE%" (
  echo.
  echo The voice-clone EXE was not downloaded.
  pause
  exit /b 1
)

:INSTALL_MODEL
echo.
echo [2/3] Downloading the OpenVoice WAV model...
echo This is a one-time setup and may take a few minutes.
echo.

if not exist "%MODEL%" mkdir "%MODEL%"

if not exist "%MODEL_CONFIG%" (
  echo Downloading model config...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Start-BitsTransfer -Source 'https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/main/converter/config.json?download=true' -Destination '%MODEL_CONFIG%' -DisplayName 'Downloading model config'"
  if errorlevel 1 goto MODEL_FAIL
)

if not exist "%MODEL_FILE%" (
  echo Downloading voice-conversion model (about 131 MB)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Start-BitsTransfer -Source 'https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/main/converter/checkpoint.pth?download=true' -Destination '%MODEL_FILE%' -DisplayName 'Downloading OpenVoice model'"
  if errorlevel 1 goto MODEL_FAIL
)

if not exist "%MODEL_FILE%" goto MODEL_FAIL
goto SELECT_SOURCE

:MODEL_FAIL
echo.
echo MODEL DOWNLOAD FAILED.
echo.
echo The downloaded model is required by the WAV clone engine.
echo Run this batch again to retry.
pause
exit /b 1

:SELECT_SOURCE
set "SOURCE="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select SOURCE WAV - audio to change'; $d.Filter='WAV audio (*.wav)|*.wav'; $d.Multiselect=$false; if($d.ShowDialog() -eq 'OK'){[Console]::WriteLine($d.FileName)}"`) do set "SOURCE=%%A"

if not defined SOURCE (
  echo No source WAV selected.
  pause
  exit /b 0
)

set "TARGET="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select TARGET WAV - voice to copy'; $d.Filter='WAV audio (*.wav)|*.wav'; $d.Multiselect=$false; if($d.ShowDialog() -eq 'OK'){[Console]::WriteLine($d.FileName)}"`) do set "TARGET=%%A"

if not defined TARGET (
  echo No target WAV selected.
  pause
  exit /b 0
)

for %%F in ("%SOURCE%") do (
  set "OUTDIR=%%~dpF"
  set "BASENAME=%%~nF"
)

set "OUTFILE=%OUTDIR%%BASENAME%_voiceclone.wav"
set "WORK=%TEMP%\wav_voice_clone_%RANDOM%"

mkdir "%WORK%" >nul 2>&1
copy /y "%SOURCE%" "%WORK%\source.wav" >nul
copy /y "%TARGET%" "%WORK%\target.wav" >nul

if not exist "%WORK%\source.wav" (
  echo.
  echo Could not prepare the source WAV.
  rmdir /s /q "%WORK%" >nul 2>&1
  pause
  exit /b 1
)

if not exist "%WORK%\target.wav" (
  echo.
  echo Could not prepare the target WAV.
  rmdir /s /q "%WORK%" >nul 2>&1
  pause
  exit /b 1
)

echo.
echo ==================================================
echo                 READY TO CONVERT
echo ==================================================
echo.
echo Source WAV: "%SOURCE%"
echo Target WAV: "%TARGET%"
echo Output WAV: "%OUTFILE%"
echo.
echo The target WAV is used as the voice reference.
echo Your source WAV keeps its spoken content.
echo.
echo Converting now...
echo.

pushd "%WORK%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p=Start-Process -FilePath '%EXE%' -ArgumentList @('-s','source.wav','-t','target.wav','-m','%MODEL%','-o','%OUTDIR%','-n','%BASENAME%_voiceclone.wav') -RedirectStandardOutput 'voiceclone.log' -RedirectStandardError 'voiceclone.err' -PassThru -NoNewWindow;" ^
  "$start=Get-Date; $i=0; $frames=@('[>...................]','[.>..................]','[..>.................]','[...>................]','[....>...............]','[.....>..............]','[......>.............]','[.......>............]','[........>...........]','[.........>..........]','[..........>.........]','[...........>........]','[............>.......]','[.............>......]','[..............>.....]','[...............>....]','[................>...]','[.................>..]','[..................>.]','[...................>]');" ^
  "while(-not $p.HasExited){ $p.Refresh(); $elapsed=(Get-Date)-$start; Write-Host ('CONVERTING  ' + $frames[$i] + '  ' + $elapsed.ToString('mm:ss')); Start-Sleep -Milliseconds 250; $i++; if($i -ge $frames.Count){$i=0} };" ^
  "$p.Refresh(); exit $p.ExitCode"

set "RESULT=%ERRORLEVEL%"

popd

echo.
if exist "%WORK%\voiceclone.log" (
  echo ----- voice-clone output -----
  type "%WORK%\voiceclone.log"
  echo ----- end output -----
  echo.
)

if exist "%WORK%\voiceclone.err" (
  echo ----- voice-clone errors -----
  type "%WORK%\voiceclone.err"
  echo ----- end errors -----
  echo.
)

rmdir /s /q "%WORK%" >nul 2>&1

if not "%RESULT%"=="0" (
  echo ==================================================
  echo               CONVERSION FAILED
  echo ==================================================
  echo.
  echo The WAV files themselves were not converted or renamed.
  echo Check the error above and run this batch again.
  echo.
  pause
  exit /b 1
)

if not exist "%OUTFILE%" (
  echo ==================================================
  echo        FINISHED - OUTPUT WAV NOT FOUND
  echo ==================================================
  echo.
  echo The engine returned successfully but did not create:
  echo "%OUTFILE%"
  echo.
  pause
  exit /b 1
)

echo ==================================================
echo              CONVERSION COMPLETE
echo ==================================================
echo.
echo Your converted WAV is here:
echo "%OUTFILE%"
echo.
pause
