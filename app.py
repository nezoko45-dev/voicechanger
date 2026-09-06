import os
import sys
import tempfile
from pathlib import Path

import gradio as gr
import librosa
import numpy as np
import torch
from huggingface_hub import snapshot_download
from scipy.io.wavfile import write
from transformers import WavLMModel

APP_DIR = Path(__file__).resolve().parent
REFERENCE_WAV = APP_DIR / "ElevenLabs_2026-08-16T20_54_01_Ava – Natural AI Voice_pvc_sp100_s50_sb75_se36_b_e2.wav"
MODEL_ROOT = Path(os.environ.get("VOICECHANGER_MODEL_DIR", APP_DIR / ".voicechanger_models"))
FREEVC_ROOT = MODEL_ROOT / "FreeVC"
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# FreeVC is text-free one-shot voice conversion: source speech is converted directly
# toward a reference speaker. The model code/checkpoint are downloaded on first run.
FREEVC_ROOT.mkdir(parents=True, exist_ok=True)
if not (FREEVC_ROOT / "models.py").exists():
    snapshot_download(
        repo_id="OlaWod/FreeVC",
        repo_type="space",
        local_dir=str(FREEVC_ROOT),
        allow_patterns=[
            "commons.py",
            "mel_processing.py",
            "models.py",
            "modules.py",
            "utils.py",
            "configs/freevc.json",
            "speaker_encoder/*",
            "checkpoints/freevc.pth",
        ],
    )

sys.path.insert(0, str(FREEVC_ROOT))
from models import SynthesizerTrn  # noqa: E402
from speaker_encoder.voice_encoder import SpeakerEncoder  # noqa: E402
import utils  # noqa: E402


CONFIG_PATH = FREEVC_ROOT / "configs" / "freevc.json"
CHECKPOINT_PATH = FREEVC_ROOT / "checkpoints" / "freevc.pth"
SPEAKER_ENCODER_PATH = FREEVC_ROOT / "speaker_encoder" / "ckpt" / "pretrained_bak_5805000.pt"

print(f"Loading FreeVC on {DEVICE}...")
hps = utils.get_hparams_from_file(str(CONFIG_PATH))
freevc = SynthesizerTrn(
    hps.data.filter_length // 2 + 1,
    hps.train.segment_size // hps.data.hop_length,
    **hps.model,
).to(DEVICE)
freevc.eval()
utils.load_checkpoint(str(CHECKPOINT_PATH), freevc, None)
speaker_encoder = SpeakerEncoder(str(SPEAKER_ENCODER_PATH), device=str(DEVICE))
content_model = WavLMModel.from_pretrained("microsoft/wavlm-large").to(DEVICE)
content_model.eval()

TARGET_EMBEDDING = None

def load_reference(path: str | None):
    global TARGET_EMBEDDING
    path = path or str(REFERENCE_WAV)
    if not Path(path).exists():
        raise FileNotFoundError(f"Reference voice not found: {path}")
    wav, _ = librosa.load(path, sr=16000)
    wav, _ = librosa.effects.trim(wav, top_db=20)
    if len(wav) < 1600:
        raise ValueError("Reference voice is too short. Use a clean voice sample of at least a few seconds.")
    embedding = speaker_encoder.embed_utterance(wav)
    TARGET_EMBEDDING = torch.from_numpy(embedding).unsqueeze(0).to(DEVICE)
    return f"✅ Reference loaded: {Path(path).name}"


def convert_chunk(audio):
    if audio is None:
        return None
    if TARGET_EMBEDDING is None:
        load_reference(str(REFERENCE_WAV))

    sample_rate, samples = audio
    samples = np.asarray(samples)
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    samples = samples.astype(np.float32)
    if samples.size == 0:
        return None

    # FreeVC expects 16 kHz source audio. Short streaming chunks keep latency bounded.
    if sample_rate != 16000:
        samples = librosa.resample(samples, orig_sr=sample_rate, target_sr=16000)

    source = torch.from_numpy(samples).unsqueeze(0).to(DEVICE)
    with torch.inference_mode():
        content = content_model(source).last_hidden_state.transpose(1, 2)
        converted = freevc.infer(content, g=TARGET_EMBEDDING)[0][0].float().cpu().numpy()

    return (hps.data.sampling_rate, converted.astype(np.float32))


def reset():
    return None, "Ready."


with gr.Blocks(title="VoiceChanger — Direct Voice Conversion") as demo:
    gr.Markdown(
        "# 🎙️ VoiceChanger\n"
        "### 🎤 Microphone → FreeVC voice conversion → 🔊 Converted voice\n\n"
        "No speech recognition. No text generation. Your spoken audio is converted directly toward the selected reference voice."
    )

    with gr.Row():
        with gr.Column():
            reference = gr.Audio(
                value=str(REFERENCE_WAV) if REFERENCE_WAV.exists() else None,
                type="filepath",
                label="🎯 Target voice reference",
            )
            load_button = gr.Button("Load reference voice")
            mic = gr.Audio(
                sources=["microphone"],
                type="numpy",
                streaming=True,
                label="🎤 Microphone",
            )
            clear = gr.Button("⏹ Reset")
        with gr.Column():
            output = gr.Audio(
                streaming=True,
                autoplay=True,
                label="🔊 Converted voice",
            )
            status = gr.Textbox(value="Ready.", label="Status")

    load_button.click(load_reference, inputs=reference, outputs=status)
    mic.stream(
        convert_chunk,
        inputs=mic,
        outputs=output,
        stream_every=0.75,
        concurrency_limit=1,
    )
    clear.click(reset, outputs=[output, status])

    gr.Markdown(
        "**Engine:** FreeVC (text-free one-shot voice conversion).  "
        "**Reference:** the Ava WAV included in this repository by default.  "
        "A GPU is strongly recommended for live conversion."
    )


if __name__ == "__main__":
    demo.queue().launch(share=bool(os.environ.get("COLAB_RELEASE_TAG")))
