import io
import os
import tempfile
from pathlib import Path

import gradio as gr
import numpy as np
import soundfile as sf
import speech_recognition as sr
import torch
from huggingface_hub import snapshot_download

from openvoice import se_extractor
from openvoice.api import ToneColorConverter
from melo.api import TTS

APP_DIR = Path(__file__).resolve().parent
REFERENCE_WAV = APP_DIR / "ElevenLabs_2026-08-16T20_54_01_Ava – Natural AI Voice_pvc_sp100_s50_sb75_se36_b_e2.wav"
CHECKPOINT_DIR = APP_DIR / "checkpoints_v2"
OUTPUT_DIR = APP_DIR / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)

# OpenVoice V2 checkpoints are hosted in the official OpenVoiceV2 model repository.
if not (CHECKPOINT_DIR / "converter" / "checkpoint.pth").exists():
    snapshot_download(
        repo_id="myshell-ai/OpenVoiceV2",
        local_dir=str(CHECKPOINT_DIR),
        allow_patterns=["converter/*", "base_speakers/ses/*"],
    )

DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
CONVERTER_DIR = CHECKPOINT_DIR / "converter"
SOURCE_SE_PATH = CHECKPOINT_DIR / "base_speakers" / "ses" / "en-newest.pth"

converter = ToneColorConverter(str(CONVERTER_DIR / "config.json"), device=DEVICE)
converter.load_ckpt(str(CONVERTER_DIR / "checkpoint.pth"))
target_se, _ = se_extractor.get_se(str(REFERENCE_WAV), converter, vad=True)
model = TTS(language="EN_NEWEST", device=DEVICE)
speaker_id = next(iter(model.hps.data.spk2id.values()))
source_se = torch.load(str(SOURCE_SE_PATH), map_location=DEVICE)
recognizer = sr.Recognizer()


def pcm_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    audio = np.asarray(audio)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    audio = np.clip(audio, -1.0, 1.0).astype(np.float32)
    out = io.BytesIO()
    sf.write(out, audio, sample_rate, format="WAV", subtype="PCM_16")
    return out.getvalue()


def transcribe(audio: np.ndarray, sample_rate: int) -> str:
    wav_bytes = pcm_to_wav_bytes(audio, sample_rate)
    with sr.AudioFile(io.BytesIO(wav_bytes)) as source:
        clip = recognizer.record(source)
    try:
        return recognizer.recognize_google(clip, language="en-US").strip()
    except (sr.UnknownValueError, sr.RequestError):
        return ""


def clone_voice(text: str):
    """Generate speech with MeloTTS and clone the reference voice with OpenVoice."""
    with tempfile.NamedTemporaryFile(suffix=".wav", dir=OUTPUT_DIR, delete=False) as src_file:
        src_path = Path(src_file.name)
    out_path = src_path.with_name(src_path.stem + "_cloned.wav")
    try:
        model.tts_to_file(text, speaker_id, str(src_path), speed=1.0)
        converter.convert(
            audio_src_path=str(src_path),
            src_se=source_se,
            tgt_se=target_se,
            output_path=str(out_path),
            message="@VoiceChanger",
        )
        return str(out_path)
    finally:
        src_path.unlink(missing_ok=True)


def process_chunk(audio, buffer):
    if audio is None:
        return buffer, "", None, "Waiting for microphone…"

    sample_rate, samples = audio
    samples = np.asarray(samples)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    samples = samples.astype(np.float32)

    buffer = np.concatenate([buffer, samples])
    needed = int(sample_rate * 2.0)
    if len(buffer) < needed:
        return buffer, "", None, "🎤 Listening…"

    chunk = buffer[:needed]
    buffer = buffer[needed:]
    text = transcribe(chunk, sample_rate)
    if not text:
        return buffer, "", None, "🎤 Listening…"

    try:
        output = clone_voice(text)
        return buffer, text, output, f"🔊 OpenVoice generated: {text}"
    except Exception as exc:
        return buffer, text, None, f"❌ OpenVoice error: {exc}"


def clear_buffer():
    return np.zeros(0, dtype=np.float32), "", None, "Ready."


with gr.Blocks(title="VoiceChanger — OpenVoice V2") as demo:
    gr.Markdown(
        "# 🎙️ VoiceChanger\n"
        "### Live microphone → SpeechRecognition → OpenVoice V2\n\n"
        "Speak into the microphone. The app transcribes short chunks and generates the words using the **Ava reference voice**."
    )

    buffer_state = gr.State(np.zeros(0, dtype=np.float32))
    with gr.Row():
        with gr.Column():
            mic = gr.Audio(
                sources=["microphone"],
                type="numpy",
                streaming=True,
                label="🎤 Microphone",
            )
            clear = gr.Button("⏹ Reset")
        with gr.Column():
            transcript = gr.Textbox(label="📝 Recognized Speech", lines=5)
            output = gr.Audio(label="🔊 OpenVoice Output", autoplay=True)
            status = gr.Textbox(label="Status", value="Ready.")

    mic.stream(
        process_chunk,
        inputs=[mic, buffer_state],
        outputs=[buffer_state, transcript, output, status],
        stream_every=0.5,
        concurrency_limit=1,
    )
    clear.click(
        clear_buffer,
        outputs=[buffer_state, transcript, output, status],
    )

    gr.Markdown(
        "**Reference voice:** Ava WAV from this repository.  \n"
        "**Model:** OpenVoice V2 + MeloTTS.  \n"
        "The model checkpoint is pulled from the public `myshell-ai/OpenVoiceV2` Hugging Face model repository at startup."
    )


if __name__ == "__main__":
    # Colab can expose Gradio through a temporary share URL. Local runs stay local.
    in_colab = bool(os.environ.get("COLAB_RELEASE_TAG"))
    demo.queue().launch(share=in_colab)
