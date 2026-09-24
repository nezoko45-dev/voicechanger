@echo off
setlocal EnableExtensions
title Native ONNX VoiceChanger
cd /d "%~dp0"

set "APP=%~dp0native\app\VoiceChanger.exe"

if not exist "%APP%" (
  echo.
  echo ==================================================
  echo          NATIVE ONNX VOICECHANGER
  echo ==================================================
  echo.
  echo Looking for the latest GitHub-built Windows EXE...
  echo.

  set "ARTIFACT=%TEMP%\voicechanger-native-artifact.zip"
  set "ARTIFACT_DIR=%TEMP%\voicechanger-native-artifact"
  set "APPDIR=%~dp0native\app"

  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop';" ^
    "$r=Invoke-RestMethod -Uri 'https://api.github.com/repos/nezoko45-dev/voicechanger/actions/artifacts?name=VoiceChanger-Native-Windows&per_page=10';" ^
    "$a=$r.artifacts | Where-Object { -not $_.expired } | Sort-Object { [datetime]$_.created_at } -Descending | Select-Object -First 1;" ^
    "if(-not $a){exit 2};" ^
    "Write-Host ('Found build artifact created ' + $a.created_at);" ^
    "Invoke-WebRequest -Uri $a.archive_download_url -OutFile '%ARTIFACT%'"
  set "DOWNLOAD_RESULT=%ERRORLEVEL%"

  if "%DOWNLOAD_RESULT%"=="0" (
    if exist "%ARTIFACT_DIR%" rmdir /s /q "%ARTIFACT_DIR%"
    mkdir "%ARTIFACT_DIR%" >nul 2>&1

    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "Expand-Archive -LiteralPath '%ARTIFACT%' -DestinationPath '%ARTIFACT_DIR%' -Force"
    if not errorlevel 1 (
      for /r "%ARTIFACT_DIR%" %%Z in (*.zip) do set "INNER=%%Z"
      if defined INNER (
        if exist "%APPDIR%" rmdir /s /q "%APPDIR%"
        mkdir "%APPDIR%"
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
          "Expand-Archive -LiteralPath '!INNER!' -DestinationPath '%APPDIR%' -Force"
      )
    )

    del /q "%ARTIFACT%" >nul 2>&1
    rmdir /s /q "%ARTIFACT_DIR%" >nul 2>&1
  )
)

if not exist "%APP%" (
  echo.
  echo No GitHub-built EXE was available.
  echo.
  echo Attempting a local native build...
  echo.
  call "%~dp0BuildNativeVoiceChanger.bat"
)

if not exist "%APP%" (
  echo.
  echo ==================================================
  echo              VOICECHANGER.EXE MISSING
  echo ==================================================
  echo.
  echo The native build did not produce the EXE.
  echo.
  pause
  exit /b 1
)

start "" "%APP%"
exit /b 0
