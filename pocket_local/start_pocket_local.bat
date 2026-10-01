@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Pocket TTS Local Voice Server

echo ==========================================
echo       POCKET TTS LOCAL VOICE SERVER
echo ==========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required for the local UI/backend.
  pause
  exit /b 1
)

set "UV_EXE=%USERPROFILE%\.local\bin\uv.exe"
if exist "%UV_EXE%" goto uv_ready
where uv >nul 2>nul
if not errorlevel 1 (
  set "UV_EXE=uv.exe"
  goto uv_ready
)
echo uv was not found. Installing uv...
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
if exist "%USERPROFILE%\.local\bin\uv.exe" set "UV_EXE=%USERPROFILE%\.local\bin\uv.exe"

:uv_ready
if not exist "%UV_EXE%" if /I not "%UV_EXE%"=="uv.exe" (
  echo Could not find uv.exe after installation.
  pause
  exit /b 1
)

set "POCKET_EXE=%USERPROFILE%\.local\bin\pocket-tts.exe"
if not exist "%POCKET_EXE%" (
  echo Installing Pocket TTS CLI...
  "%UV_EXE%" tool install --force pocket-tts==3.3.0
  if errorlevel 1 (
    echo Failed to install Pocket TTS.
    pause
    exit /b 1
  )
)
if not exist "%POCKET_EXE%" (
  where pocket-tts.exe >nul 2>nul
  if not errorlevel 1 set "POCKET_EXE=pocket-tts.exe"
)
if not exist "%POCKET_EXE%" (
  echo Could not find pocket-tts.exe.
  pause
  exit /b 1
)

set "POCKET_TTS_EXE=%POCKET_EXE%"

if not exist "models\local_english.yaml" (
  echo.
  echo Local voice-cloning weights are not installed yet.
  echo Starting the automatic one-time weight installer...
  call setup_pocket_weights.bat
  if errorlevel 1 exit /b 1
)

if not exist "models\pocket-tts\model.safetensors" (
  echo Local Pocket TTS voice-cloning model is missing.
  echo Run setup_pocket_weights.bat again.
  pause
  exit /b 1
)

if not exist "models\tokenizer\tokenizer.json" (
  echo Local Pocket TTS tokenizer is missing.
  echo Run setup_pocket_weights.bat again.
  pause
  exit /b 1
)

echo.
echo Local Pocket TTS weights are installed.
echo No runtime Hugging Face model download is required.
echo.
echo Starting local Node backend...
start "Pocket TTS Backend" /min cmd /c "set POCKET_TTS_EXE=%POCKET_TTS_EXE%&&node server.mjs"

echo Waiting for local UI...
set /a tries=0
:wait_loop
set /a tries+=1
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/health -TimeoutSec 1; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto ready
if %tries% GEQ 30 goto failed
timeout /t 1 /nobreak >nul
goto wait_loop

:ready
echo Local UI is ready.
echo Opening Chrome...
start "Pocket TTS Chrome UI" http://127.0.0.1:3000/
echo.
echo Your custom WAV is the only selectable voice.
echo Keep this window open while using the app.
:keepalive
timeout /t 3600 /nobreak >nul
goto keepalive

:failed
echo.
echo ERROR: Local UI did not start within 30 seconds.
echo Check the separate Pocket TTS Backend window.
pause
exit /b 1
