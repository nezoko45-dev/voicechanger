@echo off
setlocal
cd /d "%~dp0"
echo === Local Seed-VC Voice Changer Setup ===
where py >nul 2>nul
if errorlevel 1 (echo Python 3.10 is required.&pause&exit /b 1)
if not exist "Seed-VC\real-time-gui.py" (
  git clone https://github.com/Plachtaa/seed-vc.git Seed-VC
  if errorlevel 1 (echo Git is required.&pause&exit /b 1)
)
if not exist ".venv\Scripts\python.exe" py -3.10 -m venv .venv
call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
python -m pip install -r "Seed-VC\requirements.txt"
if errorlevel 1 (echo Dependency installation failed.&pause&exit /b 1)
echo Setup complete. First launch downloads the Seed-VC model from Hugging Face.
pause
