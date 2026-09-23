@echo off
setlocal
title ONNX Voice Changer

where py >nul 2>nul
if %errorlevel%==0 (
  echo Starting local ONNX Voice Changer...
  echo Open http://127.0.0.1:8787
  py -m http.server 8787 --bind 127.0.0.1
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo Starting local ONNX Voice Changer...
  echo Open http://127.0.0.1:8787
  python -m http.server 8787 --bind 127.0.0.1
  goto :eof
)

echo Python was not found.
echo Install Python 3 and make sure the "py" or "python" command is available.
pause
