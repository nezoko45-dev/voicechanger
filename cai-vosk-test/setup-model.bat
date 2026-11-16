@echo off
setlocal
cd /d "%~dp0"
if exist model\am\final.mdl (
  echo Vosk model already installed.
  exit /b 0
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip' -OutFile 'vosk-model.zip'"
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force 'vosk-model.zip' ."
if errorlevel 1 exit /b 1
for /d %%D in (vosk-model-small-en-us-*) do (
  if exist model rmdir /s /q model
  ren "%%D" model
)
del vosk-model.zip
echo Model ready.
