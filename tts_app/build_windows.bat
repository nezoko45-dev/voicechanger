@echo off
setlocal
cd /d "%~dp0"
where cl >nul 2>nul
if errorlevel 1 (
  echo ERROR: Open this from a Visual Studio Developer Command Prompt so cl.exe is available.
  pause
  exit /b 1
)
if not exist build mkdir build
cl /nologo /std:c++17 /O2 /EHsc main.cpp /Fe:build\tts_app.exe winmm.lib comdlg32.lib
if errorlevel 1 (
  echo BUILD FAILED
  pause
  exit /b 1
)
echo.
echo Built: build\tts_app.exe
copy /Y whisper.dll build\ >nul 2>nul
copy /Y tts.dll build\ >nul 2>nul
pause
