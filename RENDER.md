# Render deployment

This repository contains a FastAPI backend in `server.py`.

## Render Web Service

Connect `nezoko45-dev/voicechanger` to Render as a **Web Service**.

The included `render.yaml` configures:

- Runtime: Python
- Plan: Free
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn server:app --host 0.0.0.0 --port $PORT`
- Health check: `/health`
- Python: 3.11.11

Render can deploy directly from the repository using the Blueprint configuration. Render's FastAPI documentation uses the same Uvicorn pattern and requires binding to `0.0.0.0` and Render's `$PORT`. 

## Important: OpenVoice model files

The application expects these model files to exist on the server:

- `checkpoints_v2/converter/config.json`
- `checkpoints_v2/converter/checkpoint.pth`
- `checkpoints_v2/base_speakers/ses/en-newest.pth`

They are intentionally not committed to this repository because model checkpoints are large. Install/download the OpenVoice V2 and MeloTTS checkpoints during the Render build or provide them through another model-storage mechanism before starting the service.

## After deployment

Render gives the backend an HTTPS URL such as:

`https://voicechanger-openvoice.onrender.com`

The frontend should use that backend URL. For WebSocket connections, the frontend must use `wss://.../ws` when the page is served over HTTPS.

## Health check

Open:

`https://YOUR-SERVICE.onrender.com/health`

A healthy backend returns JSON containing `ok: true`.
