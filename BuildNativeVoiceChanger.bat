@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Build Native ONNX VoiceChanger
cd /d "%~dp0"

set "ROOT=%~dp0"
set "DEPS=%ROOT%native\deps"
set "ORT=%DEPS%\onnxruntime-win-x64-1.20.1"
set "RVC=%DEPS%\rvc-cpp-a6b81862adaf34bf1ca62ec81cebb6a7dfe19005"
set "BUILD=%ROOT%native\build"
set "APP=%ROOT%native\app"
set "ORT_ZIP=%TEMP%\onnxruntime-win-x64-1.20.1.zip"
set "RVC_ZIP=%TEMP%\rvc-cpp-a6b81862adaf34bf1ca62ec81cebb6a7dfe19005.zip"

echo.
echo ==================================================
echo        NATIVE ONNX RUNTIME VOICECHANGER
echo ==================================================
echo.

where cmake >nul 2>&1
if errorlevel 1 goto NO_CMAKE
where cl >nul 2>&1
if errorlevel 1 goto NO_CL

if not exist "%DEPS%" mkdir "%DEPS%"

if not exist "%ORT%\lib\onnxruntime.lib" (
  echo [1/4] Downloading official ONNX Runtime 1.20.1 SDK...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri 'https://github.com/microsoft/onnxruntime/releases/download/v1.20.1/onnxruntime-win-x64-1.20.1.zip' -OutFile '%ORT_ZIP%'"
  if errorlevel 1 goto FAIL
  if not exist "%ORT_ZIP%" goto FAIL
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Expand-Archive -LiteralPath '%ORT_ZIP%' -DestinationPath '%DEPS%' -Force"
  if errorlevel 1 goto FAIL
  del /q "%ORT_ZIP%" >nul 2>&1
)

if not exist "%RVC%\CMakeLists.txt" (
  echo [2/4] Downloading native RVC.cpp source...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri 'https://github.com/VoiceLala/rvc-cpp/archive/a6b81862adaf34bf1ca62ec81cebb6a7dfe19005.zip' -OutFile '%RVC_ZIP%'"
  if errorlevel 1 goto FAIL
  if not exist "%RVC_ZIP%" goto FAIL
  if exist "%DEPS%\rvc-extract" rmdir /s /q "%DEPS%\rvc-extract"
  mkdir "%DEPS%\rvc-extract"
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Expand-Archive -LiteralPath '%RVC_ZIP%' -DestinationPath '%DEPS%\rvc-extract' -Force"
  if errorlevel 1 goto FAIL
  move /y "%DEPS%\rvc-extract\rvc-cpp-a6b81862adaf34bf1ca62ec81cebb6a7dfe19005" "%RVC%" >nul
  if errorlevel 1 goto FAIL
  if not exist "%RVC%\CMakeLists.txt" goto FAIL
  rmdir /s /q "%DEPS%\rvc-extract" >nul 2>&1
  del /q "%RVC_ZIP%" >nul 2>&1
)

echo [3/4] Downloading bundled ONNX voice models...
echo.
if not exist "%ROOT%models" mkdir "%ROOT%models"

if not exist "%ROOT%models\GuraTalkV2.onnx" (
  echo Downloading target voice...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri 'https://huggingface.co/DogManTC/test-rvc-onnx/resolve/main/GuraTalkV2.onnx?download=true' -OutFile '%ROOT%models\GuraTalkV2.onnx'"
  if errorlevel 1 goto FAIL
)

if not exist "%ROOT%models\vec-768-layer-12.onnx" (
  echo Downloading ContentVec...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri 'https://huggingface.co/DogManTC/test-rvc-onnx/resolve/main/vec-768-layer-12.onnx?download=true' -OutFile '%ROOT%models\vec-768-layer-12.onnx'"
  if errorlevel 1 goto FAIL
)

if not exist "%ROOT%models\rmvpe.onnx" (
  echo Downloading RMVPE...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='Continue'; Invoke-WebRequest -Uri 'https://huggingface.co/DogManTC/test-rvc-onnx/resolve/main/rmvpe.onnx?download=true' -OutFile '%ROOT%models\rmvpe.onnx'"
  if errorlevel 1 goto FAIL
)

echo [4/4] Building native EXE...
echo.
if exist "%BUILD%" rmdir /s /q "%BUILD%"
mkdir "%BUILD%"

cmake -S "%ROOT%native" -B "%BUILD%" -G "Visual Studio 17 2022" -A x64 ^
  -DONNXRUNTIME_ROOT="%ORT%" ^
  -DRVC_CPP_ROOT="%RVC%"
if errorlevel 1 goto FAIL

cmake --build "%BUILD%" --config Release
if errorlevel 1 goto FAIL

if not exist "%APP%" mkdir "%APP%"
if not exist "%APP%\models" mkdir "%APP%\models"

copy /y "%BUILD%\Release\VoiceChanger.exe" "%APP%\VoiceChanger.exe" >nul
copy /y "%BUILD%\Release\dvc.dll" "%APP%\dvc.dll" >nul
copy /y "%BUILD%\Release\onnxruntime.dll" "%APP%\onnxruntime.dll" >nul
copy /y "%ROOT%models\GuraTalkV2.onnx" "%APP%\models\GuraTalkV2.onnx" >nul
copy /y "%ROOT%models\vec-768-layer-12.onnx" "%APP%\models\vec-768-layer-12.onnx" >nul
copy /y "%ROOT%models\rmvpe.onnx" "%APP%\models\rmvpe.onnx" >nul

if not exist "%APP%\VoiceChanger.exe" goto FAIL
if not exist "%APP%\dvc.dll" goto FAIL
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
echo Install Visual Studio 2022 with Desktop C++ and CMake support.
echo.
pause
exit /b 1

:NO_CL
echo MSVC cl.exe was not found.
echo Use a Visual Studio 2022 Developer Command Prompt,
echo or install the Desktop C++ workload.
echo.
pause
exit /b 1

:FAIL
echo.
echo ==================================================
echo                    BUILD FAILED
echo ==================================================
echo.
echo The window is staying open so the exact error remains visible.
echo.
pause
exit /b 1
