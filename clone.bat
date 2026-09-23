@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title OpenVoice V2 Voice Clone

set "ROOT=%~dp0"
set "INBOX=%ROOT%clone_input"
set "PROCESSED=%INBOX%\processed"
set "OUTBOX=%ROOT%cloned_voice"
set "PY=%ROOT%.venv\Scripts\python.exe"
set "PROFILE=%ROOT%clone_chrome_profile"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not exist "%INBOX%" mkdir "%INBOX%"
if not exist "%PROCESSED%" mkdir "%PROCESSED%"
if not exist "%OUTBOX%" mkdir "%OUTBOX%"
if not exist "%PROFILE%\Default" mkdir "%PROFILE%\Default"

echo ========================================
echo       OpenVoice V2 Voice Clone
echo ========================================
echo.

where py >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python launcher "py" was not found.
    echo Install Python 3 and try again.
    pause
    exit /b 1
)

if not exist "%PY%" (
    echo Creating local Python environment...
    py -3 -m venv .venv
    if errorlevel 1 (
        echo ERROR: Could not create Python environment.
        pause
        exit /b 1
    )
)

echo Checking clone dependencies...
"%PY%" -m pip install --disable-pip-version-check -r requirements-clone.txt
if errorlevel 1 (
    echo.
    echo ERROR: Dependencies failed.
    pause
    exit /b 1
)

if not exist "%CHROME%" (
    echo.
    echo WARNING: Chrome was not found.
    echo You can still copy WAV files manually into:
    echo "%INBOX%"
    echo.
) else (
    echo Starting Chrome with a dedicated download folder...

    powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:PROFILE; $d=$env:INBOX; New-Item -ItemType Directory -Force -Path ($p + '\Default') | Out-Null; $prefs=@{download=@{default_directory=$d; prompt_for_download=$false; directory_upgrade=$true}} | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath ($p + '\Default\Preferences')"

    if errorlevel 1 (
        echo.
        echo ERROR: Could not configure Chrome download folder.
        pause
        exit /b 1
    )

    start "" "%CHROME%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check "%ROOT%index.html"
)

echo.
echo WATCHING:
echo "%INBOX%"
echo.
echo Select a WAV in Chrome and click Save WAV to Clone Folder.
echo Chrome will download it directly into clone_input.
echo OpenVoice will detect it automatically.
echo.
echo Press Ctrl+C to stop.
echo.

:WATCH
for %%F in ("%INBOX%\*.wav") do (
    if exist "%%~fF" (
        echo.
        echo ========================================
        echo WAV DETECTED: %%~nxF
        echo ========================================
        echo.

        "%PY%" clone_voice.py "%%~fF"
        if errorlevel 1 (
            echo.
            echo CLONE FAILED.
            echo The WAV was left in clone_input.
            echo.
            pause
            exit /b 1
        )

        echo.
        echo ========================================
        echo CLONE COMPLETE
        echo ========================================
        echo Saved:
        echo "%OUTBOX%\voice_embedding.pth"
        echo.

        move /Y "%%~fF" "%PROCESSED%\" >nul
        if errorlevel 1 (
            echo WARNING: Could not move processed WAV.
            echo It remains in clone_input.
        )
    )
)

timeout /t 2 /nobreak >nul
goto WATCH
