@echo off
setlocal
set ROOT=%~dp0
set BIN=%ROOT%build\Release
if not exist "%BIN%\voicechanger_host.exe" (
  echo Build first with build_windows.bat
  pause
  exit /b 1
)
if "%~3"=="" (
  echo Usage: run_voicechanger.bat voice.onnx contentvec.onnx rmvpe.onnx [input_id] [output_id]
  echo.
  echo Run voicechanger_host.exe with no arguments to list device IDs.
  pause
  exit /b 2
)
"%BIN%\voicechanger_host.exe" %*
endlocal
