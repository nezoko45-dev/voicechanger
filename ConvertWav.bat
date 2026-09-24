@echo off
setlocal EnableExtensions
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

if not exist "%F0%" (
  echo RMVPE model is missing.
  echo Run the model download again.
  pause
  exit /b 1
)

set "INPUT="
for /f "usebackq delims=" %%A in (\`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select WAV recording'; $d.Filter='WAV audio (*.wav)|*.wav|All files (*.*)|*.*'; if($d.ShowDialog() -eq 'OK'){[Console]::WriteLine($d.FileName)}"\`) do set "INPUT=%%A"

if not defined INPUT (
  echo No WAV file selected.
  pause
  exit /b 0
)

set "MODEL="
for /f "usebackq delims=" %%A in (\`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='Select RVC voice model'; $d.Filter='ONNX voice model (*.onnx)|*.onnx|All files (*.*)|*.*'; if($d.ShowDialog() -eq 'OK'){[Console]::WriteLine($d.FileName)}"\`) do set "MODEL=%%A"

if not defined MODEL (
  echo No voice model selected.
  pause
  exit /b 0
)

for %%F in ("%INPUT%") do set "OUTPUT=%%~dpnF_converted.wav"

echo.
echo Input : "%INPUT%"
echo Model : "%MODEL%"
echo Output: "%OUTPUT%"
echo.
echo Converting WAV...
echo.

"%CLI%" wav --model "%MODEL%" --embedder "%ASSETS%" --f0-model "%F0%" --input "%INPUT%" --output "%OUTPUT%" --provider windowsml --speaker-id 0

if errorlevel 1 (
  echo.
  echo CONVERSION FAILED.
  echo Run vc-rs.exe doctor if the error mentions Windows ML.
  pause
  exit /b 1
)

echo.
echo ================================================
echo CONVERSION COMPLETE
echo ================================================
echo.
echo "%OUTPUT%"
echo.
pause
