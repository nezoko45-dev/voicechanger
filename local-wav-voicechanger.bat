@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

title Local WAV Voice Changer - RVC
set "BASE=%~dp0local_rvc"
set "RVC=%BASE%\RVC"
set "VENV=%BASE%\.venv"
set "MODEL_DIR=%BASE%\models"

echo ==========================================
echo          LOCAL WAV VOICE CHANGER
echo ==========================================
echo        OFFLINE RVC WAV CONVERTER
echo ==========================================
echo.
echo No Deepgram. No cloud credits.
echo.

if not exist "%VENV%\Scripts\python.exe" (
  echo RVC is not installed yet.
  echo.
  call "%~dp0setup-local-rvc.bat"
  if errorlevel 1 exit /b 1
)

if not exist "%RVC%\infer\cli.py" (
  echo ERROR: RVC CLI is missing.
  echo Run setup-local-rvc.bat again.
  pause
  exit /b 1
)

if not exist "%MODEL_DIR%" mkdir "%MODEL_DIR%"

set "INPUT=%~1"
if not defined INPUT (
  echo Drag your WAV file onto this window, or paste the full path below.
  echo.
  set /p "INPUT=Source WAV: "
)

set "INPUT=%INPUT:"=%"
if not exist "%INPUT%" (
  echo ERROR: Input file not found:
  echo %INPUT%
  pause
  exit /b 1
)

set "EXT=%~x1"
if not defined EXT set "EXT=.wav"
if /I not "%EXT%"==".wav" (
  echo WARNING: The converter accepts WAV and other formats supported by RVC.
  echo.
)

set "MODEL="
for %%M in ("%MODEL_DIR%\*.pth") do if not defined MODEL set "MODEL=%%~fM"

if defined MODEL (
  echo Found RVC model:
  echo %MODEL%
) else (
  echo.
  echo No .pth model was found in:
  echo %MODEL_DIR%
  echo.
  set /p "MODEL=Path to target RVC .pth model: "
)

set "MODEL=%MODEL:"=%"
if not exist "%MODEL%" (
  echo ERROR: Model not found:
  echo %MODEL%
  pause
  exit /b 1
)

set "MODEL_NAME=%~nxMODEL"
copy /y "%MODEL%" "%RVC%\assets\weights\%MODEL_NAME%" >nul
if errorlevel 1 (
  echo ERROR: Could not copy the model.
  pause
  exit /b 1
)

set "INDEX="
for %%I in ("%MODEL_DIR%\*.index") do if not defined INDEX set "INDEX=%%~fI"
if not defined INDEX (
  for %%I in ("%~dpMODEL\*.index") do if not defined INDEX set "INDEX=%%~fI"
)

if defined INDEX (
  set "INDEX_NAME=%~nxINDEX"
  copy /y "%INDEX%" "%RVC%\assets\indices\%INDEX_NAME%" >nul
  set "INDEX_RATE=0.75"
  echo Index: %INDEX_NAME%
) else (
  set "INDEX_RATE=0"
  echo Index: none - retrieval disabled
)

for %%F in ("%INPUT%") do (
  set "STEM=%%~nF"
  set "OUTDIR=%%~dpF"
)
set "OUT=%OUTDIR%converted_%STEM%.wav"

set "PITCH=0"
echo.
set /p "PITCH=Pitch shift in semitones [0]: "
if not defined PITCH set "PITCH=0"

echo.
echo Source : "%INPUT%"
echo Model  : "%MODEL_NAME%"
echo Output : "%OUT%"
echo Pitch  : %PITCH%
echo.
echo Starting offline RVC conversion...
echo.

pushd "%RVC%"
if "%INDEX_RATE%"=="0" (
  "%VENV%\Scripts\python.exe" infer\cli.py --model "assets\weights\%MODEL_NAME%" --input "%INPUT%" --output "%OUT%" --pitch %PITCH% --f0-method rmvpe --index-rate 0 --overwrite
) else (
  "%VENV%\Scripts\python.exe" infer\cli.py --model "assets\weights\%MODEL_NAME%" --input "%INPUT%" --output "%OUT%" --pitch %PITCH% --f0-method rmvpe --index "assets\indices\%INDEX_NAME%" --index-rate %INDEX_RATE% --overwrite
)
set "RC=%ERRORLEVEL%"
popd

echo.
if "%RC%"=="0" (
  echo ==========================================
  echo CONVERSION COMPLETE
  echo ==========================================
  echo.
  echo "%OUT%"
  echo.
  start "" "%OUT%"
) else (
  echo ==========================================
  echo CONVERSION FAILED
  echo ==========================================
  echo.
  echo RVC returned error code %RC%.
)
echo.
pause
exit /b %RC%
