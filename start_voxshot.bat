@echo off
setlocal
title VoxShot Voice Clone

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not defined CHROME (
  echo Chrome was not found.
  echo Install Google Chrome, then run this file again.
  pause
  exit /b 1
)

echo Starting VoxShot in Chrome...
echo.
echo WebGPU flags are enabled for this launch.
echo Keep this window open while using the app.
echo.

start "" "%CHROME%" --app="https://nezoko45-dev.github.io/voicechanger/" --enable-unsafe-webgpu --ignore-gpu-blocklist --enable-features=Vulkan,UseSkiaRenderer

exit /b 0
