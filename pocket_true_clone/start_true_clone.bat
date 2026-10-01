@echo off
setlocal
cd /d "%~dp0"
title True Pocket TTS Voice Clone
where node.exe >nul 2>nul
if errorlevel 1 (echo Node.js is required. Install Node.js LTS, then rerun.&pause&exit /b 1)
where uv.exe >nul 2>nul
if errorlevel 1 (
 echo uv is required. Installing uv...
 powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
 set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)
if not exist "%USERPROFILE%\.local\bin\pocket-tts.exe" (
 echo Pocket TTS is not installed. Running setup...
 call setup_true_clone.bat
 if errorlevel 1 exit /b 1
)
echo Starting TRUE custom-WAV Pocket TTS backend...
start "Pocket TTS Backend" cmd /k node server.mjs
powershell -NoProfile -Command "$ok=$false;for($i=0;$i -lt 60;$i++){try{$r=Invoke-WebRequest http://127.0.0.1:8789/health -UseBasicParsing -TimeoutSec 2;if($r.StatusCode -eq 200){$ok=$true;break}}catch{};Start-Sleep -Milliseconds 500};if(-not $ok){exit 1}"
if errorlevel 1 (echo Backend failed to start.&pause&exit /b 1)
start "" "http://127.0.0.1:8789/"
echo Chrome UI opened.
