import json
import os
import queue
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
from piper import PiperVoice

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "local_agent_data"
VOICE_DIR = DATA / "voices"
VOICE_DIR.mkdir(parents=True, exist_ok=True)

SAMPLE_RATE = 16000
CHANNELS = 1
BLOCK_SECONDS = 0.03
BLOCK_SIZE = int(SAMPLE_RATE * BLOCK_SECONDS)

# Small local model keeps CPU/RAM requirements reasonable.
WHISPER_MODEL = os.environ.get("LOCAL_AGENT_WHISPER", "base.en")
OLLAMA_MODEL = os.environ.get("LOCAL_AGENT_MODEL", "llama3.2:3b")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
VOICE_NAME = os.environ.get("LOCAL_AGENT_VOICE", "en_US-lessac-medium")

# Speech detection. Increase START_RMS if background noise triggers recording.
START_RMS = float(os.environ.get("LOCAL_AGENT_START_RMS", "0.018"))
END_RMS = float(os.environ.get("LOCAL_AGENT_END_RMS", "0.010"))
SILENCE_SECONDS = float(os.environ.get("LOCAL_AGENT_SILENCE", "0.75"))
MAX_UTTERANCE_SECONDS = float(os.environ.get("LOCAL_AGENT_MAX", "18"))

SYSTEM_PROMPT = """You are a local real-time voice assistant.
Keep replies natural and fairly short so they can be spoken quickly.
Do not announce that you are an AI unless asked.
Never ask 'How can I help?' unless the user explicitly asks for help.
Respond directly to what the user said.
"""

def rms(x):
    if x.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(x), dtype=np.float64)))

def list_devices():
    devices = sd.query_devices()
    print("\nAudio devices:")
    for i, d in enumerate(devices):
        ins = int(d["max_input_channels"])
        outs = int(d["max_output_channels"])
        if ins or outs:
            flags = []
            if ins:
                flags.append(f"in:{ins}")
            if outs:
                flags.append(f"out:{outs}")
            print(f"  {i:>3}  {d['name']}  ({', '.join(flags)})")
    print()

def choose_device(kind):
    env = os.environ.get(f"LOCAL_AGENT_{kind.upper()}_DEVICE")
    if env:
        try:
            return int(env)
        except ValueError:
            pass
    return None

def ollama_chat(text, history):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history[-8:])
    messages.append({"role": "user", "content": text})
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0.7}
    }).encode("utf-8")

    req = urllib.request.Request(
        OLLAMA_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.URLError as e:
        raise RuntimeError(
            "Ollama is not running. Start Ollama and run: ollama pull "
            + OLLAMA_MODEL
        ) from e

    reply = data.get("message", {}).get("content", "").strip()
    if not reply:
        raise RuntimeError("Ollama returned an empty response.")
    return reply

def find_voice():
    manual = os.environ.get("LOCAL_AGENT_VOICE_PATH")
    if manual and Path(manual).exists():
        return Path(manual)

    local_model = VOICE_DIR / f"{VOICE_NAME}.onnx"
    if local_model.exists():
        return local_model

    raise RuntimeError(
        f"Piper voice is missing: {local_model}. "
        "The launcher should download it before starting."
    )

def load_voice():
    voice = find_voice()
    try:
        return PiperVoice.load(voice)
    except Exception as e:
        raise RuntimeError(
            f"Could not load Piper voice '{VOICE_NAME}'. "
            "Run the launcher again so Piper can download it."
        ) from e

def play_pcm(audio, sample_rate, output_device):
    # Piper returns int16 audio chunks. Play them through the selected
    # Windows output device without writing temporary WAV files.
    if audio.dtype != np.int16:
        audio = audio.astype(np.int16)
    sd.play(audio, samplerate=sample_rate, device=output_device, blocking=True)
    sd.stop()

def speak(voice, text, output_device):
    chunks = []
    rate = None
    for chunk in voice.synthesize(text):
        rate = chunk.sample_rate
        chunks.append(np.frombuffer(chunk.audio_int16_bytes, dtype=np.int16))
    if chunks:
        play_pcm(np.concatenate(chunks), rate or 22050, output_device)

def transcribe(model, audio):
    segments, _ = model.transcribe(
        audio,
        language="en",
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
        temperature=0.0,
    )
    return " ".join(s.text.strip() for s in segments).strip()

def main():
    print("=" * 58)
    print("        LOCAL PYTHON VOICE AGENT")
    print("=" * 58)
    print("100% local after model downloads. No Deepgram/Moshi.")
    print(f"Whisper: {WHISPER_MODEL}")
    print(f"Ollama:  {OLLAMA_MODEL}")
    print(f"Piper:   {VOICE_NAME}")
    print()

    if "--devices" in sys.argv:
        list_devices()
        return

    input_device = choose_device("input")
    output_device = choose_device("output")

    if input_device is None:
        input_device = sd.default.device[0]
    if output_device is None:
        output_device = sd.default.device[1]

    print(f"Input device:  {input_device}")
    print(f"Output device: {output_device}")
    print("\nLoading Whisper...")
    model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    print("Loading Piper...")
    voice = load_voice()
    print("Agent ready.")
    print("Speak normally. Pause briefly when you finish a sentence.")
    print("Press Ctrl+C to stop.\n")

    audio_queue = queue.Queue()

    def callback(indata, frames, callback_time, status):
        if status:
            print(f"\nAudio: {status}", flush=True)
        audio_queue.put(indata[:, 0].copy())

    history = []
    recording = False
    utterance = []
    silence = 0.0
    total = 0.0

    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        blocksize=BLOCK_SIZE,
        channels=CHANNELS,
        dtype="float32",
        device=input_device,
        callback=callback,
    ):
        while True:
            block = audio_queue.get()
            level = rms(block)
            active_threshold = START_RMS if not recording else END_RMS

            if not recording:
                if level >= active_threshold:
                    recording = True
                    utterance = [block]
                    silence = 0.0
                    total = BLOCK_SECONDS
                    print("Listening...", flush=True)
                continue

            utterance.append(block)
            total += BLOCK_SECONDS

            if level < END_RMS:
                silence += BLOCK_SECONDS
            else:
                silence = 0.0

            if silence >= SILENCE_SECONDS or total >= MAX_UTTERANCE_SECONDS:
                recording = False
                audio = np.concatenate(utterance).astype(np.float32)
                utterance = []
                silence = 0.0
                total = 0.0

                print("Thinking...", flush=True)
                try:
                    text = transcribe(model, audio)
                    if not text:
                        print("I didn't catch that.\n", flush=True)
                        continue

                    print(f"You: {text}")
                    reply = ollama_chat(text, history)
                    print(f"Agent: {reply}\n", flush=True)

                    history.append({"role": "user", "content": text})
                    history.append({"role": "assistant", "content": reply})
                    speak(voice, reply, output_device)
                except Exception as e:
                    print(f"ERROR: {e}\n", flush=True)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception as e:
        print(f"\nFATAL ERROR: {e}")
        input("Press Enter to close...")
