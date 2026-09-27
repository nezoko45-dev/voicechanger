@echo off
setlocal EnableExtensions
title Hugging Face Realtime - WebSocket

echo ==========================================================
echo        HUGGING FACE REALTIME - WEBSOCKET
echo ==========================================================
echo.
echo No Python backend will be started.
echo Opening the hosted Hugging Face realtime WebSocket app...
echo.
echo This is the same WebSocket-based realtime stack, but the
echo speech backend runs on Hugging Face instead of this PC.
echo.

start "" "https://artfix0-speech-to-speech-dashboard.hf.space/"

echo Browser opened.
echo.
echo In the Hugging Face app:
echo   1. Click the orb.
echo   2. Allow microphone access.
echo   3. Open Settings if needed.
echo   4. Set the instruction to repeat your words exactly.
echo.
pause
