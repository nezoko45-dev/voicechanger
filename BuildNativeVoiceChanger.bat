@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Build Native ONNX VoiceChanger
cd /d "%~dp0"

set "ROOT=%~dp0"
set "DEPS=%ROOT%native\deps"
set "ORT=%DEPS%\onnxruntime-win-x64-1.20.1"
set "BUILD=%ROOT%native\build"
set "APP=%ROOT%native\app"
set "ORT_ZIP=%TEMP%\onnxruntime-win-x64-1.20.1.zip"

echo.
echo ==================================================
echo        NATIVE ONNX RUNTIME VOICECHANGER
echo ==================================================
echo.

where cmake >nul 2>&1
if errorlevel 1 goto NO_CMAKE

rem Load a Visual Studio C++ environment automatically when possible.
if not defined VSCMD_VER (
  if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" (
    for /f "usebackq delims=" %%V in (\`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath\`) do set "VSROOT=%%V"
    if defined VSROOT if exist "!VSROOT!\Common7\Tools\VsDevCmd.bat" call "!VSROOT!\Common7\Tools\VsDevCmd.bat" -arch=x64 >nul
  )
)

where cl >nul 2>&1
if errorlevel 1 goto NO_CL

if not exist "%DEPS%" mkdir "%DEPS%"

if not exist "%ORT%\lib\onnxruntime.lib" (
  echo [1/3] Downloading official ONNX Runtime 1.20.1 SDK...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri 'https://github.com/microsoft/onnxruntime/releases/download/v1.20.1/onnxruntime-win-x64-1.20.1.zip' -OutFile '%ORT_ZIP%'"
  if errorlevel 1 goto FAIL
  if not exist "%ORT_ZIP%" goto FAIL
  echo Extracting ONNX Runtime...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Expand-Archive -LiteralPath '%ORT_ZIP%' -DestinationPath '%DEPS%' -Force"
  if errorlevel 1 goto FAIL
  del /q "%ORT_ZIP%" >nul 2>&1
)

if not exist "%ROOT%models" mkdir "%ROOT%models"

if not exist "%ROOT%models\GuraTalkV2.onnx" (
  echo [2/3] Downloading target voice ONNX...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri 'https://huggingface.co/DogManTC/test-rvc-onnx/resolve/main/GuraTalkV2.onnx?download=true' -OutFile '%ROOT%models\GuraTalkV2.onnx'"
  if errorlevel 1 goto FAIL
)

if not exist "%ROOT%models\vec-768-layer-12.onnx" (
  echo Downloading ContentVec ONNX...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri 'https://huggingface.co/DogManTC/test-rvc-onnx/resolve/main/vec-768-layer-12.onnx?download=true' -OutFile '%ROOT%models\vec-768-layer-12.onnx'"
  if errorlevel 1 goto FAIL
)

echo [3/3] Building native EXE...
echo.
if exist "%BUILD%" rmdir /s /q "%BUILD%"
mkdir "%BUILD%"

cmake -S "%ROOT%native" -B "%BUILD%" -G "Visual Studio 17 2022" -A x64 "-DONNXRUNTIME_ROOT=%ORT%"
if errorlevel 1 goto FAIL

cmake --build "%BUILD%" --config Release --parallel
if errorlevel 1 goto FAIL

if not exist "%APP%" mkdir "%APP%"
if not exist "%APP%\models" mkdir "%APP%\models"

copy /y "%BUILD%\Release\VoiceChanger.exe" "%APP%\VoiceChanger.exe" >nul
copy /y "%BUILD%\Release\onnxruntime.dll" "%APP%\onnxruntime.dll" >nul
copy /y "%ROOT%models\GuraTalkV2.onnx" "%APP%\models\GuraTalkV2.onnx" >nul
copy /y "%ROOT%models\vec-768-layer-12.onnx" "%APP%\models\vec-768-layer-12.onnx" >nul

if not exist "%APP%\VoiceChanger.exe" goto FAIL
if not exist "%APP%\onnxruntime.dll" goto FAIL

echo.
echo ==================================================
echo                 BUILD COMPLETE
echo ==================================================
echo.
echo Native EXE:
echo "%APP%\VoiceChanger.exe"
echo.
pause
exit /b 0

:NO_CMAKE
echo CMake was not found.
echo Install Visual Studio 2022 with Desktop development with C++.
echo.
pause
exit /b 1

:NO_CL
echo Visual C++ was not found.
echo Install Visual Studio 2022 with Desktop development with C++.
echo This batch also tries to load the Visual Studio build environment automatically.
echo.
pause
exit /b 1

:FAIL
echo.
echo ==================================================
echo                    BUILD FAILED
echo ==================================================
echo.
echo The window stays open so the exact error remains visible.
echo.
pause
exit /b 1
