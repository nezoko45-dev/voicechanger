@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python is required only to BUILD this executable locally.
  echo End users can download the prebuilt EXE from GitHub Actions without installing Python.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 goto failed
)
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failed
".venv\Scripts\pyinstaller.exe" --noconfirm --clean --onefile --console --name VoiceClonNX --add-data "index.html;." --add-data "model-probe.html;." --collect-all voiceclonnx --collect-all onnxruntime --collect-all soundfile --collect-all numpy --collect-all huggingface_hub server.py
if errorlevel 1 goto failed
echo.
echo Build complete: dist\VoiceClonNX.exe
pause
exit /b 0
:failed
echo Build failed. See the error above.
pause
exit /b 1
