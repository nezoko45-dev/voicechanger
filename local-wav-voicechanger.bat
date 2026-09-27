@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

title Local WAV Voice Changer - RVC
set "BASE=%~dp0local_rvc"
set "RVC=%BASE%\RVC"
set "VENV=%BASE%\.venv"
set "MODEL_DIR=%BASE%\models"
set "INPUT="
set "MODEL="
set "INDEX="
set "RC=1"

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
  echo Running one-time setup...
  call "%~dp0setup-local-rvc.bat"
  if errorlevel 1 (
    echo.
    echo SETUP FAILED.
    goto :END
  )
)

if not exist "%RVC%\infer\cli.py" (
  echo ERROR: RVC CLI is missing.
  echo Run setup-local-rvc.bat again.
  goto :END
)

if not exist "%MODEL_DIR%" mkdir "%MODEL_DIR%" >nul 2>nul
if not exist "%RVC%\assets\weights" mkdir "%RVC%\assets\weights" >nul 2>nul
if not exist "%RVC%\assets\indices" mkdir "%RVC%\assets\indices" >nul 2>nul

echo Choose the WAV file to convert.
for /f "usebackq delims=" %%I in (\`powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; $o=New-Object System.Windows.Forms.OpenFileDialog; $o.Filter='WAV audio (*.wav)|*.wav|All supported audio (*.wav;*.flac;*.mp3;*.m4a)|*.wav;*.flac;*.mp3;*.m4a|All files (*.*)|*.*'; $o.Title='Choose the source audio'; if($o.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){$o.FileName}"\`) do set "INPUT=%%I"

if not defined INPUT (
  echo.
  echo File picker cancelled.
  echo You can also drag a WAV file onto this batch file.
  goto :END
)

echo.
echo Source:
echo "%INPUT%"
echo.

echo Looking for an RVC voice model in:
echo "%MODEL_DIR%"
echo.

for /f "delims=" %%M in ('dir /b /a-d "%MODEL_DIR%\*.pth" 2^>nul') do (
  if not defined MODEL set "MODEL=%MODEL_DIR%\%%M"
)

if defined MODEL (
  echo Found:
  echo "%MODEL%"
) else (
  echo No .pth model was found automatically.
  echo Choose your target voice model.
  for /f "usebackq delims=" %%I in (\`powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; $o=New-Object System.Windows.Forms.OpenFileDialog; $o.Filter='RVC model (*.pth)|*.pth'; $o.Title='Choose the target RVC voice model'; if($o.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){$o.FileName}"\`) do set "MODEL=%%I"
)

if not defined MODEL (
  echo.
  echo No RVC model selected.
  goto :END
)

if not exist "%MODEL%" (
  echo.
  echo ERROR: Model not found:
  echo "%MODEL%"
  goto :END
)

set "MODEL_NAME=%~nxMODEL"
copy /y "%MODEL%" "%RVC%\assets\weights\%MODEL_NAME%" >nul
if errorlevel 1 (
  echo.
  echo ERROR: Could not copy the voice model.
  goto :END
)

echo.
echo Optional: choose a matching .index file.
echo Cancel the dialog to continue without an index.
for /f "usebackq delims=" %%I in (\`powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; $o=New-Object System.Windows.Forms.OpenFileDialog; $o.Filter='RVC index (*.index)|*.index'; $o.Title='Optional matching RVC index'; if($o.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){$o.FileName}"\`) do set "INDEX=%%I"

set "INDEX_RATE=0"
if defined INDEX (
  set "INDEX_NAME=%~nxINDEX"
  copy /y "%INDEX%" "%RVC%\assets\indices\%INDEX_NAME%" >nul
  if errorlevel 1 (
    echo WARNING: Index could not be copied. Continuing without it.
    set "INDEX="
  ) else (
    set "INDEX_RATE=0.75"
    echo Index: "%INDEX_NAME%"
  )
)

if not defined INDEX echo Index: none

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
echo ==========================================
echo READY TO CONVERT
echo ==========================================
echo Source : "%INPUT%"
echo Model  : "%MODEL_NAME%"
echo Output : "%OUT%"
echo Pitch  : %PITCH%
echo Index  : %INDEX_RATE%
echo.
echo Converting now...
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
  echo       CONVERSION COMPLETE!
  echo ==========================================
  echo.
  echo Output:
  echo "%OUT%"
  echo.
  if exist "%OUT%" start "" "%OUT%"
) else (
  echo ==========================================
  echo        CONVERSION FAILED
  echo ==========================================
  echo.
  echo RVC returned error code %RC%.
  echo The console will stay open so you can read the error.
)

:END
echo.
echo ==========================================
echo This window will stay open.
echo ==========================================
pause
exit /b %RC%
