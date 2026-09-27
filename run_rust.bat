@echo off
setlocal
cd /d "%~dp0"

where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust/Cargo is not installed.
  echo Install Rust from https://rustup.rs/ and run this file again.
  pause
  exit /b 1
)

echo Building Rust RVC voice changer...
cargo run --release

if errorlevel 1 (
  echo.
  echo Build or runtime failed.
  pause
)
