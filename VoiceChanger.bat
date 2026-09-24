@echo off
setlocal EnableExtensions EnableDelayedExpansion
title VoiceChanger - C# ONNX Runtime
cd /d "%~dp0"

set "ROOT=%~dp0"
set "SDK=%ROOT%.dotnet"
set "PROJECT=%ROOT%csharp\VoiceChanger.csproj"
set "PUBLISH=%ROOT%csharp\bin\Release\net8.0-windows\win-x64\publish"
set "DOTNET=%SDK%\dotnet.exe"
set "SDK_INSTALL=%TEMP%\dotnet-install-voicechanger.ps1"

echo.
echo ==================================================
echo             C# ONNX RUNTIME VOICECHANGER
echo ==================================================
echo.
echo No C++ compiler is required.
echo.

if not exist "%DOTNET%" (
  echo [1/4] Downloading the local .NET 8 SDK...
  echo This is a one-time setup.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Invoke-WebRequest -UseBasicParsing -Uri 'https://dot.net/v1/dotnet-install.ps1' -OutFile '%SDK_INSTALL%'"
  if errorlevel 1 goto FAIL

  powershell -NoProfile -ExecutionPolicy Bypass -File "%SDK_INSTALL%" -Channel 8.0 -Architecture x64 -InstallDir "%SDK%" -NoPath
  if errorlevel 1 goto FAIL
)

if not exist "%DOTNET%" (
  echo.
  echo .NET SDK setup failed.
  echo.
  pause
  exit /b 1
)

if not exist "%ROOT%models" mkdir "%ROOT%models"

if not exist "%ROOT%models\GuraTalkV2.onnx" (
  echo [2/4] Downloading built-in target voice model...
  echo.
  set "VC_URL=https://huggingface.co/DogManTC/test-rvc-onnx/resolve/main/GuraTalkV2.onnx?download=true"
  set "VC_OUT=%ROOT%models\GuraTalkV2.onnx"
  call :DOWNLOAD_WITH_PROGRESS
  if errorlevel 1 goto FAIL
)

if not exist "%ROOT%models\vec-768-layer-12.onnx" (
  echo.
  echo [3/4] Downloading ContentVec model...
  echo Size: about 378 MB.
  echo A live progress counter is shown below.
  echo.

  set "VC_URL=https://huggingface.co/DogManTC/test-rvc-onnx/resolve/main/vec-768-layer-12.onnx?download=true"
  set "VC_OUT=%ROOT%models\vec-768-layer-12.onnx"
  call :DOWNLOAD_WITH_PROGRESS
  if errorlevel 1 goto FAIL
)

echo.
echo [4/4] Building C# VoiceChanger.exe...
echo.
set "DOTNET_CLI_TELEMETRY_OPTOUT=1"
set "NUGET_XMLDOC_MODE=skip"

"%DOTNET%" restore "%PROJECT%" --verbosity minimal
if errorlevel 1 goto FAIL

"%DOTNET%" publish "%PROJECT%" -c Release -r win-x64 --self-contained true --no-restore --verbosity minimal
if errorlevel 1 goto FAIL

if not exist "%PUBLISH%\VoiceChanger.exe" goto FAIL

if not exist "%PUBLISH%\models" mkdir "%PUBLISH%\models"
copy /y "%ROOT%models\GuraTalkV2.onnx" "%PUBLISH%\models\GuraTalkV2.onnx" >nul
copy /y "%ROOT%models\vec-768-layer-12.onnx" "%PUBLISH%\models\vec-768-layer-12.onnx" >nul

echo.
echo ==================================================
echo                 BUILD COMPLETE
echo ==================================================
echo.
echo Opening VoiceChanger.exe...
echo.
start "" "%PUBLISH%\VoiceChanger.exe"
exit /b 0

:DOWNLOAD_WITH_PROGRESS
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$url=$env:VC_URL; $out=$env:VC_OUT;" ^
  "$tmp=$out+'.download';" ^
  "if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Force};" ^
  "$client=[System.Net.Http.HttpClient]::new();" ^
  "$client.Timeout=[TimeSpan]::FromHours(2);" ^
  "$resp=$client.GetAsync($url,[System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result;" ^
  "$resp.EnsureSuccessStatusCode();" ^
  "$total=$resp.Content.Headers.ContentLength;" ^
  "$src=$resp.Content.ReadAsStreamAsync().Result;" ^
  "$dst=[System.IO.File]::Create($tmp);" ^
  "$buf=New-Object byte[] 1048576; $done=0L; $last=Get-Date;" ^
  "try { while(($n=$src.Read($buf,0,$buf.Length)) -gt 0) { $dst.Write($buf,0,$n); $done += $n; $now=Get-Date; if(($now-$last).TotalMilliseconds -ge 250) { $prefix=[string][char]13; if($total){$pct=[int](100*$done/$total); $mb=[math]::Round($done/1MB,1); $tm=[math]::Round($total/1MB,1); Write-Host -NoNewline ($prefix + ('Downloading: {0}%  {1} / {2} MB' -f $pct,$mb,$tm))} else {Write-Host -NoNewline ($prefix + ('Downloading: {0} MB' -f [math]::Round($done/1MB,1)))}; $last=$now } } } finally { $dst.Dispose(); $src.Dispose(); $resp.Dispose(); $client.Dispose() };" ^
  "Move-Item -LiteralPath $tmp -Destination $out -Force;" ^
  "Write-Host ([string][char]13 + ('Download complete: {0} MB                    ' -f [math]::Round($done/1MB,1)))"
exit /b %ERRORLEVEL%

:FAIL
echo.
echo ==================================================
echo                    BUILD FAILED
echo ==================================================
echo.
echo The window will stay open so the exact error remains visible.
echo.
pause
exit /b 1
