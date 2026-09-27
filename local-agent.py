import os, queue, sys
from pathlib import Path
import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
from piper import PiperVoice

ROOT = Path(__file__).resolve().parent
VOICE_DIR = ROOT / "local_agent_data" / "voices"
VOICE_DIR.mkdir(parents=True, exist_ok=True)

RATE = 16000
BLOCK = 480
START_RMS = 0.018
END_RMS = 0.010
SILENCE = 0.65
MAX_SECONDS = 15
VOICE = VOICE_DIR / "en_US-amy-medium.onnx"

def rms(x):
    return float(np.sqrt(np.mean(np.square(x), dtype=np.float64))) if x.size else 0

def main():
    print("=" * 55)
    print("       LOCAL PYTHON VOICE REPEATER")
    print("=" * 55)
    print("Whisper STT + Piper TTS")
    print("No Ollama. No Deepgram. No cloud API.")
    print()

    if "--devices" in sys.argv:
        for i, d in enumerate(sd.query_devices()):
            if d["max_input_channels"] or d["max_output_channels"]:
                print(i, d["name"], "in:", int(d["max_input_channels"]),
                      "out:", int(d["max_output_channels"]))
        return

    inp = sd.default.device[0]
    out = sd.default.device[1]
    print("Input:", inp)
    print("Output:", out)
    print("Loading Whisper...")
    whisper = WhisperModel("tiny.en", device="cpu", compute_type="int8")
    print("Loading Piper...")
    if not VOICE.exists():
        raise RuntimeError("Piper voice is missing. Run start-local-agent.bat again.")
    piper = PiperVoice.load(str(VOICE))
    print("READY - speak normally, then pause briefly.")
    print("Press Ctrl+C to stop.\n")

    q = queue.Queue()
    def callback(indata, frames, time_info, status):
        if status:
            print("Audio:", status, flush=True)
        q.put(indata[:, 0].copy())

    recording = False
    chunks = []
    silence = 0
    total = 0

    with sd.InputStream(samplerate=RATE, blocksize=BLOCK, channels=1,
                        dtype="float32", device=inp, callback=callback):
        while True:
            block = q.get()
            level = rms(block)

            if not recording:
                if level >= START_RMS:
                    recording = True
                    chunks = [block]
                    silence = 0
                    total = len(block) / RATE
                    print("Listening...", flush=True)
                continue

            chunks.append(block)
            total += len(block) / RATE
            silence = silence + len(block) / RATE if level < END_RMS else 0

            if silence >= SILENCE or total >= MAX_SECONDS:
                recording = False
                audio = np.concatenate(chunks).astype(np.float32)
                chunks = []
                print("Recognizing...", flush=True)

                segments, _ = whisper.transcribe(
                    audio, language="en", beam_size=1,
                    vad_filter=True, condition_on_previous_text=False,
                    temperature=0.0)
                text = " ".join(s.text.strip() for s in segments).strip()

                if not text:
                    print("Nothing recognized.\n")
                    continue

                print("You:", text)
                print("Repeating...", flush=True)

                for chunk in piper.synthesize(text):
                    pcm = np.frombuffer(chunk.audio_int16_bytes, dtype=np.int16)
                    sd.play(pcm, samplerate=chunk.sample_rate, device=out, blocking=True)
                sd.stop()
                print("READY\n", flush=True)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception as e:
        print("\nERROR:", e)
        input("Press Enter to close...")
