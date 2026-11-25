@echo off
setlocal
cd /d "%~dp0"
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust Cargo was not found.
  echo Install Rust stable from https://rustup.rs/ and reopen this window.
  pause
  exit /b 1
)
echo Building Rust WAV Reference Voice Changer...
cargo build --release
if errorlevel 1 (
  echo.
  echo Build failed. Check the Rust compiler output above.
  pause
  exit /b 1
)
echo.
echo Built: %CD%\target\release\rust-wav-reference-voicechanger.exe
pause
