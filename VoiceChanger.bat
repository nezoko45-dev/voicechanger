@echo off
setlocal EnableExtensions EnableDelayedExpansion
title VoiceChanger - C# + ONNX Runtime
cd /d "%~dp0"

set "ROOT=%~dp0"
set "SDK=%ROOT%.dotnet"
set "PROJECT=%ROOT%csharp\VoiceChanger.csproj"
set "PUBLISH=%ROOT%csharp\bin\Release\net8.0-windows\win-x64\publish"
set "DOTNET=%SDK%\dotnet.exe"
set "INSTALLER=%TEMP%\voicechanger-dotnet-install.ps1"
set "MODEL_DIR=%ROOT%models"
set "VOICE=%MODEL_DIR%\GuraTalkV2.onnx"
set "CONTENT=%MODEL_DIR%\vec-768-layer-12.onnx"
set "VOICE_URL=https://huggingface.co/DogManTC/test-rvc-onnx/resolve/main/GuraTalkV2.onnx?download=true"
set "CONTENT_URL=https://huggingface.co/DogManTC/test-rvc-onnx/resolve/main/vec-768-layer-12.onnx?download=true"
set "VOICE_SHA=c13d815167ba9a39f6d045f89d64eb5e6f85120890e6684642ec46d7549d3a1d"
set "CONTENT_SHA=b3886e7dff1495cda514f94f4680a7b1261e05d6929f5c764cdb17934b413c2a"

echo.
echo ==================================================
echo          C# ONNX RUNTIME VOICECHANGER
echo ==================================================
echo.
echo No C++ compiler. No CMake. No RVC.cpp.
echo.

if not exist "%DOTNET%" (
  echo [1/3] Installing a private .NET 8 SDK...
  echo.

  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing 'https://dot.net/v1/dotnet-install.ps1' -OutFile '%INSTALLER%'"
  if errorlevel 1 goto FAIL

  powershell -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%" -Channel 8.0 -Architecture x64 -InstallDir "%SDK%" -NoPath
  if errorlevel 1 goto FAIL
)

if not exist "%DOTNET%" (
  echo.
  echo .NET SDK was not installed correctly.
  goto FAIL
)

set "DOTNET_ROOT=%SDK%"
set "DOTNET_ROOT_X64=%SDK%"
set "PATH=%SDK%;%PATH%"
set "DOTNET_CLI_TELEMETRY_OPTOUT=1"
set "NUGET_XMLDOC_MODE=skip"

if not exist "%MODEL_DIR%" mkdir "%MODEL_DIR%"

if not exist "%VOICE%" (
  echo [2/3] Downloading built-in target voice...
  call :DownloadFile "%VOICE_URL%" "%VOICE%"
  if errorlevel 1 goto FAIL
)

if not exist "%CONTENT%" (
  echo [2/3] Downloading ContentVec...
  echo This model is large. Please wait for the download to finish.
  call :DownloadFile "%CONTENT_URL%" "%CONTENT%"
  if errorlevel 1 goto FAIL
)

call :CheckFile "%VOICE%" 10000000
if errorlevel 1 (
  echo.
  echo Target voice model is missing or incomplete.
  goto FAIL
)

call :CheckFile "%CONTENT%" 100000000
if errorlevel 1 (
  echo.
  echo ContentVec model is missing or incomplete.
  goto FAIL
)

call :CheckHash "%VOICE%" "%VOICE_SHA%"
if errorlevel 1 (
  echo.
  echo Target voice model is not the expected GuraTalkV2 ONNX file.
  echo Re-downloading the verified file...
  del /q "%VOICE%" >nul 2>&1
  call :DownloadFile "%VOICE_URL%" "%VOICE%"
  if errorlevel 1 goto FAIL
  call :CheckHash "%VOICE%" "%VOICE_SHA%"
  if errorlevel 1 goto FAIL
)

call :CheckHash "%CONTENT%" "%CONTENT_SHA%"
if errorlevel 1 (
  echo.
  echo ContentVec model is not the expected file.
  echo Re-downloading the verified file...
  del /q "%CONTENT%" >nul 2>&1
  call :DownloadFile "%CONTENT_URL%" "%CONTENT%"
  if errorlevel 1 goto FAIL
  call :CheckHash "%CONTENT%" "%CONTENT_SHA%"
  if errorlevel 1 goto FAIL
)

echo.
echo [3/3] Building the C# application...
echo.

if exist "%ROOT%csharp\bin" rmdir /s /q "%ROOT%csharp\bin"
if exist "%ROOT%csharp\obj" rmdir /s /q "%ROOT%csharp\obj"

echo Restoring NuGet packages...
"%DOTNET%" restore "%PROJECT%" --disable-parallel --verbosity minimal
if errorlevel 1 goto FAIL

echo Publishing self-contained Windows x64 EXE...
"%DOTNET%" publish "%PROJECT%" -c Release -r win-x64 --self-contained true --no-restore --verbosity minimal
if errorlevel 1 goto FAIL

if not exist "%PUBLISH%\VoiceChanger.exe" (
  echo.
  echo Build completed but VoiceChanger.exe was not created.
  goto FAIL
)

if not exist "%PUBLISH%\models" mkdir "%PUBLISH%\models"
copy /y "%VOICE%" "%PUBLISH%\models\GuraTalkV2.onnx" >nul
copy /y "%CONTENT%" "%PUBLISH%\models\vec-768-layer-12.onnx" >nul

echo.
echo ==================================================
echo                 BUILD COMPLETE
echo ==================================================
echo.
echo Launching:
echo "%PUBLISH%\VoiceChanger.exe"
echo.

start "" "%PUBLISH%\VoiceChanger.exe"
exit /b 0

:DownloadFile
set "DL_URL=%~1"
set "DL_OUT=%~2"
set "DL_TMP=%DL_OUT%.partial"

if exist "%DL_TMP%" del /q "%DL_TMP%" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; " ^
  "$u=$env:DL_URL; $o=$env:DL_TMP; " ^
  "$wc=[Net.WebClient]::new(); " ^
  "try { $wc.DownloadFile($u,$o) } finally { $wc.Dispose() }"

if errorlevel 1 (
  echo.
  echo Download failed:
  echo %DL_URL%
  if exist "%DL_TMP%" del /q "%DL_TMP%" >nul 2>&1
  exit /b 1
)

if not exist "%DL_TMP%" exit /b 1

move /y "%DL_TMP%" "%DL_OUT%" >nul
if errorlevel 1 exit /b 1

exit /b 0

:CheckFile
set "CHECK_FILE=%~1"
set "CHECK_MIN=%~2"

if not exist "%CHECK_FILE%" exit /b 1

for %%F in ("%CHECK_FILE%") do set "CHECK_SIZE=%%~zF"

if not defined CHECK_SIZE exit /b 1
if %CHECK_SIZE% LSS %CHECK_MIN% exit /b 1

exit /b 0

:CheckHash
set "HASH_FILE=%~1"
set "HASH_EXPECTED=%~2"

if not exist "%HASH_FILE%" exit /b 1
set "HASH_ACTUAL="
for /f "usebackq delims=" %%H in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-FileHash -Algorithm SHA256 -LiteralPath '%HASH_FILE%').Hash.ToLowerInvariant()"`) do set "HASH_ACTUAL=%%H"

if /i not "%HASH_ACTUAL%"=="%HASH_EXPECTED%" exit /b 1

exit /b 0

:FAIL
echo.
echo ==================================================
echo                    SETUP FAILED
echo ==================================================
echo.
echo The window is staying open so the exact error remains visible.
echo.
pause
exit /b 1
