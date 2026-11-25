@echo off
setlocal
echo Installing Babiniku CPU engine with WAV reference voice-print support...
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust Cargo is required. Install Rust stable from https://rustup.rs/
  pause
  exit /b 1
)
cargo install --git https://github.com/m96-chan/babiniku.rs babiniku --features wavlm --locked
if errorlevel 1 (
  echo Engine installation failed. Review the Cargo error above.
  pause
  exit /b 1
)
echo.
echo Babiniku installed. If the GUI cannot find it, set its executable path to:
echo %%USERPROFILE%%\.cargo\bin\babiniku.exe
pause
