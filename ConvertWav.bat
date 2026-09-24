@echo off
setlocal EnableExtensions EnableDelayedExpansion
title RVC WAV Voice Converter
cd /d "%~dp0"

set "APPDIR=%~dp0vc-rs"
set "CLI=%APPDIR%\vc-rs.exe"
set "ASSETS=%APPDIR%\assets\content_vec_500.onnx"
set "F0=%APPDIR%\assets\rmvpe.onnx"

echo.
echo ================================================
echo             RVC WAV VOICE CONVERTER
echo ================================================
echo.
echo Select a WAV recording, then your RVC .ONNX voice model.
echo The result will be saved beside the recording as:
echo   filename_converted.wav
echo.

if not exist "%CLI%" (
  echo vc-rs.exe is not installed.
  echo Run VoiceChanger.bat first.
  pause
  exit /b 1
)

if not exist "%ASSETS%" (
  echo ContentVec model is missing.
  echo Downloading required support models...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%APPDIR%\download-models.ps1"
  if errorlevel 1 (
    echo Could not download the support models.
    pause
    exit /b 1
  )
)

if not exist "%ASSETS%" (
  echo ContentVec model is still missing.
  pause
  exit /b 1
)

if not exist "%F0%" (
  echo RMVPE model is missing.
  echo Run the model download again.
  pause
  exit /b 1
)

set "INPUT="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select WAV recording'; $d.Filter='WAV audio (*.wav)|*.wav|All files (*.*)|*.*'; if($d.ShowDialog() -eq 'OK'){[Console]::WriteLine($d.FileName)}"`) do set "INPUT=%%A"

if not defined INPUT (
  echo No WAV file selected.
  pause
  exit /b 0
)

set "MODEL="
for /f "usebackq delims=" %%A in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select RVC voice model'; $d.Filter='ONNX voice model (*.onnx)|*.onnx|All files (*.*)|*.*'; if($d.ShowDialog() -eq 'OK'){[Console]::WriteLine($d.FileName)}"`) do set "MODEL=%%A"

if not defined MODEL (
  echo No voice model selected.
  pause
  exit /b 0
)

for %%F in ("%INPUT%") do set "OUTPUT=%%~dpnF_converted.wav"

set "VCRS_CLI=%CLI%"
set "VCRS_MODEL=%MODEL%"
set "VCRS_EMBEDDER=%ASSETS%"
set "VCRS_F0=%F0%"
set "VCRS_INPUT=%INPUT%"
set "VCRS_OUTPUT=%OUTPUT%"
set "VCRS_LOG=%TEMP%\vc-rs-convert-%RANDOM%.log"
set "VCRS_ERR=%TEMP%\vc-rs-convert-%RANDOM%.err"

echo.
echo Input : "%INPUT%"
echo Model : "%MODEL%"
echo Output: "%OUTPUT%"
echo.
echo ================================================
echo                CONVERSION RUNNING
echo ================================================
echo.
echo RVC's WAV CLI does not provide a percentage counter.
echo This window now shows a LIVE moving activity bar
echo and elapsed time until conversion finishes.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Start-Process -FilePath $env:VCRS_CLI -ArgumentList @('wav','--model',$env:VCRS_MODEL,'--embedder',$env:VCRS_EMBEDDER,'--f0-model',$env:VCRS_F0,'--input',$env:VCRS_INPUT,'--output',$env:VCRS_OUTPUT,'--provider','windowsml','--speaker-id','0') -RedirectStandardOutput $env:VCRS_LOG -RedirectStandardError $env:VCRS_ERR -PassThru -NoNewWindow;" ^
  "$start=Get-Date; $i=0; $frames=@('[>...................]','[.>..................]','[..>.................]','[...>................]','[....>...............]','[.....>..............]','[......>.............]','[.......>............]','[........>...........]','[.........>..........]','[..........>.........]','[...........>........]','[............>.......]','[.............>......]','[..............>.....]','[...............>....]','[................>...]','[.................>..]','[..................>.]','[...................>]');" ^
  "while(-not $p.HasExited){ $p.Refresh(); $elapsed=(Get-Date)-$start; Write-Host ('CONVERTING  ' + $frames[$i] + '  ' + $elapsed.ToString('mm:ss')); Start-Sleep -Milliseconds 250; $i++; if($i -ge $frames.Count){$i=0} };" ^
  "$p.Refresh(); $elapsed=(Get-Date)-$start; Write-Host ('CONVERTING  [....................]  ' + $elapsed.ToString('mm:ss')); exit $p.ExitCode"

set "RESULT=%ERRORLEVEL%"

echo.
if exist "%VCRS_LOG%" (
  echo ----- vc-rs output -----
  type "%VCRS_LOG%"
  echo ----- end vc-rs output -----
  echo.
)
if exist "%VCRS_ERR%" (
  echo ----- vc-rs errors -----
  type "%VCRS_ERR%"
  echo ----- end vc-rs errors -----
  echo.
)

del /q "%VCRS_LOG%" "%VCRS_ERR%" >nul 2>&1

if not "%RESULT%"=="0" (
  echo ================================================
  echo              CONVERSION FAILED
  echo ================================================
  echo.
  echo Check the vc-rs output above for the exact error.
  echo.
  pause
  exit /b 1
)

if not exist "%OUTPUT%" (
  echo ================================================
  echo        CONVERSION FINISHED - NO OUTPUT
  echo ================================================
  echo.
  echo vc-rs returned success, but the WAV file was not created.
  echo.
  pause
  exit /b 1
)

echo ================================================
echo             CONVERSION COMPLETE
echo ================================================
echo.
echo Converted WAV:
echo "%OUTPUT%"
echo.
pause
