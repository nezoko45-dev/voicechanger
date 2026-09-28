@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "rvc-realtime\venv\Scripts\python.exe" (
  echo RVC is not installed yet.
  echo Run setup_rvc.bat first.
  exit /b 1
)

cd /d "%~dp0rvc-realtime"

echo Installing Hugging Face downloader...
venv\Scripts\python.exe -m pip install --upgrade huggingface_hub
if errorlevel 1 exit /b 1

echo.
echo Downloading HuBERT...
venv\Scripts\hf.exe download lj1995/VoiceConversionWebUI --revision main --include "hubert_base/*" --local-dir assets
if errorlevel 1 exit /b 1

echo.
echo Downloading RMVPE...
venv\Scripts\hf.exe download lj1995/VoiceConversionWebUI rmvpe.pt --revision main --local-dir assets/rmvpe
if errorlevel 1 exit /b 1

echo.
echo Downloading pretrained training models...
venv\Scripts\hf.exe download lj1995/VoiceConversionWebUI --revision main --include "pretrained/*" "pretrained_v2/*" --local-dir assets
if errorlevel 1 exit /b 1

if not exist ".model-downloads\mute.zip" (
  echo.
  echo Downloading training silence samples...
  venv\Scripts\hf.exe download lj1995/VoiceConversionWebUI mute.zip --revision main --local-dir .model-downloads
  if errorlevel 1 exit /b 1
)

if not exist "logs\mute" mkdir "logs\mute"
if not exist "logs\mute\pretrained" (
  echo Extracting training silence samples...
  venv\Scripts\python.exe -m zipfile -e ".model-downloads\mute.zip" logs
  if errorlevel 1 exit /b 1
)

cd /d "%~dp0"

if not exist "rvc-realtime\ffmpeg.exe" (
  echo.
  echo Downloading FFmpeg...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/ffmpeg.exe?download=true'; Invoke-WebRequest -Uri $u -OutFile 'rvc-realtime\ffmpeg.exe'"
  if errorlevel 1 echo WARNING: FFmpeg download failed.
)

if not exist "rvc-realtime\ffprobe.exe" (
  echo Downloading FFprobe...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/ffprobe.exe?download=true'; Invoke-WebRequest -Uri $u -OutFile 'rvc-realtime\ffprobe.exe'"
  if errorlevel 1 echo WARNING: FFprobe download failed.
)

echo.
echo RVC model download step complete.
exit /b 0
