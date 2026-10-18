#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

PYTHON=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)'; then
      PYTHON="$candidate"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo "Python 3.10 or newer is required. Install it from https://www.python.org/downloads/"
  exit 1
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "Creating Python virtual environment..."
  "$PYTHON" -m venv .venv
fi

echo "Installing or updating backend dependencies..."
".venv/bin/python" -m pip install --upgrade pip
".venv/bin/python" -m pip install -r backend/requirements.txt

echo
echo "VoiceChanger backend starting at http://127.0.0.1:8765"
echo "Keep this terminal open while using the extension. Press Ctrl+C to stop."
exec ".venv/bin/python" -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
