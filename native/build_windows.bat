@echo off
setlocal
if not exist build mkdir build
if not exist third_party mkdir third_party
set ORT_VER=1.24.5
set ORT_DIR=%CD%\third_party\onnxruntime-win-x64-%ORT_VER%
set ORT_ZIP=%CD%\third_party\onnxruntime-win-x64-%ORT_VER%.zip
if not exist "%ORT_DIR%\include\onnxruntime_cxx_api.h" (
  echo Downloading ONNX Runtime %ORT_VER%...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://github.com/microsoft/onnxruntime/releases/download/v%ORT_VER%/onnxruntime-win-x64-%ORT_VER%.zip' -OutFile '%ORT_ZIP%'"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force '%ORT_ZIP%' '%CD%\third_party'"
)
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 -DONNXRUNTIME_ROOT="%ORT_DIR%"
if errorlevel 1 exit /b 1
cmake --build build --config Release --parallel
if errorlevel 1 exit /b 1
echo.
echo Built files:
dir /b build\Release\voicechanger_host.exe
dir /b build\Release\voicechanger.dll
endlocal
