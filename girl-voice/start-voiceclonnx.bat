@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title VoiceChanger - VoiceClonNX

echo.
echo  VoiceChanger - VoiceClonNX
echo  -------------------------
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  set "PYTHON=py -3"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python 3.10 or newer was not found.
    echo Install Python from https://www.python.org/downloads/
    echo Make sure "Add Python to PATH" is checked.
    pause
    exit /b 1
  )
  set "PYTHON=python"
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating local Python environment...
  %PYTHON% -m venv .venv
  if errorlevel 1 goto failed
)

echo Installing or checking required packages...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install voiceclonnx fastapi "uvicorn[standard]" python-multipart
if errorlevel 1 goto failed

:menu
echo.
echo Choose an action:
echo   1. Start the local server for the Chrome extension
echo   2. Batch-convert WAV files with OpenVoice V2
echo   3. Exit
echo.
set "CHOICE="
set /p "CHOICE=Enter 1, 2, or 3: "

if "%CHOICE%"=="1" goto server
if "%CHOICE%"=="2" goto batch
if "%CHOICE%"=="3" goto end
echo Please enter 1, 2, or 3.
goto menu

:server
echo.
echo Starting local API at http://127.0.0.1:8765
echo Keep this window open while using the extension.
echo Press Ctrl+C to stop the server.
echo.
".venv\Scripts\python.exe" server.py
echo.
echo Server stopped.
pause
goto menu

:batch
echo.
echo Put the source WAV files you want to convert in:
echo   %~dp0input-wavs
echo Converted files will be saved in:
echo   %~dp0output-wavs
echo.
if not exist "input-wavs" mkdir "input-wavs"
if not exist "output-wavs" mkdir "output-wavs"
set "REFERENCE="
set /p "REFERENCE=Enter the full path to your reference-voice WAV file: "
if not exist "%REFERENCE%" (
  echo ERROR: Reference file not found: "%REFERENCE%"
  pause
  goto menu
)
if not exist "input-wavs\*.wav" (
  echo No WAV files found in the input-wavs folder.
  echo Copy your source WAV files there, then choose batch convert again.
  pause
  goto menu
)
echo.
echo Starting OpenVoice V2 batch conversion...
echo This may download model files the first time.
echo.
for %%F in ("input-wavs\*.wav") do (
  echo.
  echo Converting: %%~nxF
  ".venv\Scripts\voiceclonnx.exe" clone --engine openvoice --audio "%%~fF" --voice "%REFERENCE%" --out "%~dp0output-wavs\%%~nF_converted.wav"
  if errorlevel 1 (
    echo FAILED: %%~nxF
  ) else (
    echo Saved: output-wavs\%%~nF_converted.wav
  )
)
echo.
echo Batch conversion finished. Check the output-wavs folder.
pause
goto menu

:failed
echo.
echo Setup failed. Read the error above, then try again.
pause
exit /b 1

:end
exit /b 0
