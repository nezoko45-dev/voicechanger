import os
import sys
import subprocess
from pathlib import Path


def ensure_dependencies():
    packages = [
        "gradio>=6,<7",
        "numpy>=1.26,<3",
        "soundfile>=0.12,<1",
        "requests>=2.31,<3",
    ]
    try:
        import gradio  # noqa: F401
        import numpy  # noqa: F401
        import soundfile  # noqa: F401
        import requests  # noqa: F401
    except ImportError:
        print("Installing VoiceChanger dependencies...")
        subprocess.check_call([
            sys.executable,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            *packages,
        ])


ensure_dependencies()

import io
import tempfile

import gradio as gr
import numpy as np
import requests
import soundfile as sf

APP_DIR = Path(__file__).resolve().parent

DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "").strip()
FISH_API_KEY = os.environ.get("FISH_API_KEY", "").strip()
FISH_REFERENCE_ID = os.environ.get("FISH_REFERENCE_ID", "").strip()
FISH_MODEL = os.environ.get("FISH_MODEL", "s2.1-pro-free").strip()
DEEPGRAM_MODEL = os.environ.get("DEEPGRAM_MODEL", "nova-3").strip()

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
FISH_URL = "https://api.fish.audio/v1/tts"


def check_configuration():
    missing = []
    if not DEEPGRAM_API_KEY:
        missing.append("DEEPGRAM_API_KEY")
    if not FISH_API_KEY:
        missing.append("FISH_API_KEY")
    if missing:
        return "⚠️ Missing environment variables: " + ", ".join(missing)
    return "✅ Deepgram + Fish Audio are configured."


def transcribe_audio(audio):
    if audio is None:
        return ""
    if not DEEPGRAM_API_KEY:
        raise RuntimeError("DEEPGRAM_API_KEY is not configured.")

    sample_rate, samples = audio
    samples = np.asarray(samples)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    samples = samples.astype(np.float32)
    if samples.size == 0:
        return ""

    buffer = io.BytesIO()
    sf.write(buffer, samples, int(sample_rate), format="WAV", subtype="PCM_16")
    audio_bytes = buffer.getvalue()

    response = requests.post(
        DEEPGRAM_URL,
        params={
            "model": DEEPGRAM_MODEL,
            "smart_format": "true",
            "punctuate": "true",
        },
        headers={
            "Authorization": f"Token {DEEPGRAM_API_KEY}",
            "Content-Type": "audio/wav",
        },
        data=audio_bytes,
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()

    return (
        payload.get("results", {})
        .get("channels", [{}])[0]
        .get("alternatives", [{}])[0]
        .get("transcript", "")
        .strip()
    )


def fish_tts(text):
    if not text:
        return None
    if not FISH_API_KEY:
        raise RuntimeError("FISH_API_KEY is not configured.")

    body = {
        "text": text,
        "format": "mp3",
    }
    if FISH_REFERENCE_ID:
        body["reference_id"] = FISH_REFERENCE_ID

    response = requests.post(
        FISH_URL,
        headers={
            "Authorization": f"Bearer {FISH_API_KEY}",
            "Content-Type": "application/json",
            "model": FISH_MODEL,
        },
        json=body,
        timeout=60,
    )
    response.raise_for_status()

    temp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3", dir=APP_DIR)
    temp.write(response.content)
    temp.close()
    return temp.name


def process_audio(audio):
    """Microphone -> Deepgram STT -> Fish Audio TTS -> playback."""
    transcript = transcribe_audio(audio)
    if not transcript:
        return None, ""

    output_path = fish_tts(transcript)
    return output_path, transcript


def refresh_status():
    return check_configuration()


with gr.Blocks(title="VoiceChanger — Deepgram + Fish Audio") as demo:
    gr.Markdown(
        "# 🎙️ VoiceChanger\n"
        "### 🎤 Microphone → Deepgram STT → Fish Audio TTS → 🔊 Voice\n\n"
        "Speak into the microphone. Deepgram transcribes your speech, then Fish Audio immediately synthesizes the transcript into speech."
    )

    with gr.Row():
        with gr.Column():
            mic = gr.Audio(
                sources=["microphone"],
                type="numpy",
                label="🎤 Microphone",
            )
            convert = gr.Button("▶️ Convert Voice", variant="primary")
            status = gr.Textbox(value=check_configuration(), label="Status", interactive=False)

        with gr.Column():
            transcript = gr.Textbox(label="📝 Deepgram transcript", interactive=False)
            output = gr.Audio(label="🔊 Fish Audio output", autoplay=True)

    convert.click(
        process_audio,
        inputs=mic,
        outputs=[output, transcript],
    )

    demo.load(refresh_status, outputs=status)

    gr.Markdown(
        "**Deepgram:** speech recognition via the standard API key in `DEEPGRAM_API_KEY`.  "
        "**Fish Audio:** TTS via `FISH_API_KEY`; optionally set `FISH_REFERENCE_ID` for a specific Fish voice.  "
        "API keys are read from environment variables and are never stored in this repository."
    )


if __name__ == "__main__":
    demo.queue().launch(share=bool(os.environ.get("COLAB_RELEASE_TAG")))
