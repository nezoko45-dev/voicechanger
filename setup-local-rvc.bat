@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

title Local WAV Voice Changer - Setup
set "BASE=%~dp0local_rvc"
set "RVC=%BASE%\RVC"
set "VENV=%BASE%\.venv"
set "DL=%BASE%\downloads"

echo ==========================================
echo       LOCAL WAV VOICE CHANGER SETUP
echo ==========================================
echo.
echo Installing the current RVC offline inference stack.
echo No Deepgram and no cloud voice credits.
echo.
echo NOTE: the first setup downloads several large files.
echo.

if not exist "%BASE%" mkdir "%BASE%"
if not exist "%DL%" mkdir "%DL%"

where py >nul 2>nul
if errorlevel 1 (
  echo Python Launcher not found. Trying winget...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo ERROR: winget is not available.
    echo Install Python 3.12 x64, then run this again.
    pause
    exit /b 1
  )
  winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo ERROR: Python 3.12 installation failed.
    pause
    exit /b 1
  )
)

py -3.12 --version >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python 3.12 x64 was not found.
  echo Close this window, restart Windows if needed, then run setup again.
  pause
  exit /b 1
)

if not exist "%RVC%\infer\cli.py" (
  echo Downloading current RVC source...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/archive/refs/heads/main.zip';$z='%DL%\rvc-main.zip';Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $z;if(Test-Path '%RVC%'){Remove-Item '%RVC%' -Recurse -Force};if(Test-Path '%BASE%\extract'){Remove-Item '%BASE%\extract' -Recurse -Force};Expand-Archive -Force $z '%BASE%\extract';$src=Get-ChildItem '%BASE%\extract' -Directory | Select-Object -First 1;Move-Item $src.FullName '%RVC%';Remove-Item '%BASE%\extract' -Recurse -Force"
  if errorlevel 1 (
    echo ERROR: RVC source download/extract failed.
    pause
    exit /b 1
  )
)

if not exist "%VENV%\Scripts\python.exe" (
  echo Creating Python environment...
  py -3.12 -m venv "%VENV%"
  if errorlevel 1 (
    echo ERROR: Could not create the Python environment.
    pause
    exit /b 1
  )
)

echo Upgrading pip...
"%VENV%\Scripts\python.exe" -m pip install --upgrade pip setuptools wheel
if errorlevel 1 (
  echo ERROR: pip setup failed.
  pause
  exit /b 1
)

if not exist "%BASE%\requirements-installed.txt" (
  echo Installing RVC CPU dependencies...
  echo This can take a while.
  "%VENV%\Scripts\python.exe" -m pip install -r "%RVC%\requirments_cpu_py312.txt"
  if errorlevel 1 (
    echo ERROR: RVC dependencies failed.
    pause
    exit /b 1
  )
  >"%BASE%\requirements-installed.txt" echo installed
)

if not exist "%RVC%\assets\hubert_base\pytorch_model.bin" (
  echo Downloading HuBERT model...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force '%RVC%\assets\hubert_base' | Out-Null;Invoke-WebRequest -UseBasicParsing -Uri 'https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/hubert_base/config.json?download=true' -OutFile '%RVC%\assets\hubert_base\config.json';Invoke-WebRequest -UseBasicParsing -Uri 'https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/hubert_base/preprocessor_config.json?download=true' -OutFile '%RVC%\assets\hubert_base\preprocessor_config.json';Invoke-WebRequest -UseBasicParsing -Uri 'https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/hubert_base/pytorch_model.bin?download=true' -OutFile '%RVC%\assets\hubert_base\pytorch_model.bin'"
  if errorlevel 1 (
    echo ERROR: HuBERT download failed.
    pause
    exit /b 1
  )
)

if not exist "%RVC%\assets\rmvpe\rmvpe.pt" (
  echo Downloading RMVPE...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force '%RVC%\assets\rmvpe' | Out-Null;Invoke-WebRequest -UseBasicParsing -Uri 'https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt?download=true' -OutFile '%RVC%\assets\rmvpe\rmvpe.pt'"
  if errorlevel 1 (
    echo ERROR: RMVPE download failed.
    pause
    exit /b 1
  )
)

mkdir "%RVC%\assets\weights" 2>nul
mkdir "%RVC%\assets\indices" 2>nul
mkdir "%BASE%\models" 2>nul

echo.
echo ==========================================
echo SETUP COMPLETE
echo ==========================================
echo.
echo Put your RVC .pth model in:
echo %BASE%\models
echo.
echo Then run:
echo local-wav-voicechanger.bat
echo.
pause
