@echo off
setlocal EnableExtensions EnableDelayedExpansion
title VoiceChanger - C# ONNX Runtime
cd /d "%~dp0"

set "ROOT=%~dp0"
set "SDK=%ROOT%.dotnet"
set "PROJECT=%ROOT%csharp\VoiceChanger.csproj"
set "PUBLISH=%ROOT%csharp\bin\Release\net8.0-windows\win-x64\publish"
set "DOTNET=%SDK%\dotnet.exe"
set "SDK_INSTALL=%TEMP%\dotnet-install-voicechanger.ps1"

echo.
echo ==================================================
echo             C# ONNX RUNTIME VOICECHANGER
echo ==================================================
echo.
echo No C++ compiler is required.
echo.

if not exist "%DOTNET%" (
  echo [1/4] Downloading the local .NET 8 SDK...
  echo This is a one-time setup.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Invoke-WebRequest -UseBasicParsing -Uri 'https://dot.net/v1/dotnet-install.ps1' -OutFile '%SDK_INSTALL%'"
  if errorlevel 1 goto FAIL

  powershell -NoProfile -ExecutionPolicy Bypass -File "%SDK_INSTALL%" -Channel 8.0 -Architecture x64 -InstallDir "%SDK%" -NoPath
  if errorlevel 1 goto FAIL
)

if not exist "%DOTNET%" (
  echo.
  echo .NET SDK setup failed.
  echo.
  pause
  exit /b 1
)

if not exist "%ROOT%models" mkdir "%ROOT%models"

if not exist "%ROOT%models\GuraTalkV2.onnx" (
  echo [2/4] Downloading the built-in target voice model...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Invoke-WebRequest -UseBasicParsing -Uri 'https://huggingface.co/DogManTC/test-rvc-onnx/resolve/main/GuraTalkV2.onnx?download=true' -OutFile '%ROOT%models\GuraTalkV2.onnx'"
  if errorlevel 1 goto FAIL
)

if not exist "%ROOT%models\vec-768-layer-12.onnx" (
  echo [3/4] Downloading the ContentVec model...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Invoke-WebRequest -UseBasicParsing -Uri 'https://huggingface.co/DogManTC/test-rvc-onnx/resolve/main/vec-768-layer-12.onnx?download=true' -OutFile '%ROOT%models\vec-768-layer-12.onnx'"
  if errorlevel 1 goto FAIL
)

echo [4/4] Building C# VoiceChanger.exe...
echo.
"%DOTNET%" restore "%PROJECT%"
if errorlevel 1 goto FAIL

"%DOTNET%" publish "%PROJECT%" -c Release -r win-x64 --self-contained true --no-restore
if errorlevel 1 goto FAIL

if not exist "%PUBLISH%\VoiceChanger.exe" goto FAIL

copy /y "%ROOT%models\GuraTalkV2.onnx" "%PUBLISH%\models\GuraTalkV2.onnx" >nul
copy /y "%ROOT%models\vec-768-layer-12.onnx" "%PUBLISH%\models\vec-768-layer-12.onnx" >nul

echo.
echo ==================================================
echo                 BUILD COMPLETE
echo ==================================================
echo.
echo Opening VoiceChanger.exe...
echo.
start "" "%PUBLISH%\VoiceChanger.exe"
exit /b 0

:FAIL
echo.
echo ==================================================
echo                    BUILD FAILED
echo ==================================================
echo.
echo The window will stay open so the error is visible.
echo.
pause
exit /b 1
