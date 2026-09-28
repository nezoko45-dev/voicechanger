@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ==========================================
echo   TRAIN YOUR REFERENCE VOICE FOR RVC
echo ==========================================
echo.

if not exist "Recording (10).wav" (
  echo ERROR: Recording (10).wav was not found in this repo folder.
  pause
  exit /b 1
)

if not exist "rvc-realtime\webui.py" (
  echo RVC is not installed yet.
  echo Running setup_rvc.bat...
  call setup_rvc.bat
  if errorlevel 1 exit /b 1
)

if not exist "rvc-realtime\ffmpeg.exe" (
  echo FFmpeg is missing. Running the model/download step...
  call download_rvc_models.bat
  if errorlevel 1 exit /b 1
)

if not exist "rvc-dataset" mkdir "rvc-dataset"

echo.
echo Converting Recording (10).wav into a real mono PCM WAV...
echo This is intentional because the repo file is actually an MP4 container
echo with a .wav filename.
"rvc-realtime\ffmpeg.exe" -y -i "Recording (10).wav" -vn -ac 1 -ar 40000 -c:a pcm_s16le "rvc-dataset\reference.wav"
if errorlevel 1 (
  echo.
  echo ERROR: FFmpeg could not decode the reference file.
  echo Check the console output above.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo   DATASET READY
echo ==========================================
echo.
echo RVC will now open its training WebUI.
echo.
echo In the training tab use:
echo.
echo   Experiment/model name: uwu_girl
echo   Training dataset folder: %CD%\rvc-dataset
echo   Target sample rate: 40k
echo   Version: v2
echo   Pitch extraction: RMVPE
echo.
echo The WebUI will perform preprocessing, feature extraction,
echo training, and index generation.
echo.
echo When training finishes, the final inference model should be
echo under:
echo   rvc-realtime\assets\weights\
echo.
echo The model is NOT created by renaming the WAV; it is created
echo by the RVC training process.
echo.

cd /d "%~dp0rvc-realtime"
venv\Scripts\python.exe webui.py
