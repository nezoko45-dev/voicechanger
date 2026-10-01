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

set "POCKET_UV=%UV_EXE%"
echo Starting local Node backend first...
start "Pocket TTS Backend" /min cmd /c "set POCKET_UV=%POCKET_UV%&&node server.mjs"

echo Waiting for http://127.0.0.1:3000/health ...
set /a tries=0
:wait_loop
set /a tries+=1
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/health -TimeoutSec 1; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto ready
if %tries% GEQ 60 goto failed
timeout /t 1 /nobreak >nul
goto wait_loop

:ready
echo Backend is ready.
echo Opening Chrome UI...
start "Pocket TTS Chrome UI" http://127.0.0.1:3000/
echo.
echo Keep this launcher open while using the app.
:keepalive
timeout /t 3600 /nobreak >nul
goto keepalive

:failed
echo.
echo ERROR: Local backend did not start within 60 seconds.
echo Check the separate Pocket TTS Backend window for the real error.
pause
exit /b 1
