import queue, sys, threading, time
from pathlib import Path

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
from piper import PiperVoice

ROOT = Path(__file__).resolve().parent
VOICE_DIR = ROOT / "local_agent_data" / "voices"
VOICE = VOICE_DIR / "en_US-amy-medium.onnx"

RATE = 16000
BLOCK = 320                  # 20 ms
WINDOW_SECONDS = 1.15        # short rolling recognition window
STEP_SECONDS = 0.45          # recognize while the user is still talking
OVERLAP_SECONDS = 0.70
START_RMS = 0.012
END_RMS = 0.008
MAX_BUFFER_SECONDS = 8.0


def rms(x):
    return float(np.sqrt(np.mean(np.square(x), dtype=np.float64))) if x.size else 0.0


def normalize_words(text):
    return " ".join(text.lower().strip().split())


def new_words(old_text, new_text):
    """Return only a new suffix when Whisper's rolling transcript grows."""
    old = normalize_words(old_text).split()
    new = normalize_words(new_text).split()

    common = 0
    for i in range(min(len(old), len(new))):
        if old[i] != new[i]:
            break
        common += 1

    # Whisper can revise the last word. Keep one word back as a safety margin.
    stable_count = max(0, common - 1)
    if len(new) > stable_count:
        return " ".join(new[stable_count:]), " ".join(new[:stable_count])
    return "", " ".join(new)


def main():
    print("=" * 62)
    print("       LOCAL SYNCHRONIZED PYTHON VOICE REPEATER")
    print("=" * 62)
    print("Whisper STT + Piper TTS")
    print("Female voice: Amy")
    print("No Ollama. No Deepgram. No cloud API.")
    print()
    print("This version keeps listening while Amy speaks.")
    print("She repeats new speech continuously instead of waiting for silence.")
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

    print("Loading Piper Amy...")
    if not VOICE.exists():
        raise RuntimeError("Piper voice is missing. Run start-local-agent.bat again.")
    piper = PiperVoice.load(str(VOICE))

    print("READY - start talking normally.")
    print("Amy will begin repeating short pieces while you are still talking.")
    print("Press Ctrl+C to stop.\n")

    audio_q = queue.Queue()
    speech_buffer = []
    last_recognition = 0.0
    recognized_stable = ""
    last_activity = time.monotonic()

    # Audio playback gets its own worker so microphone capture never stops
    # while Piper is speaking.
    tts_q = queue.Queue(maxsize=8)

    def audio_callback(indata, frames, time_info, status):
        if status:
            print("Audio:", status, flush=True)
        audio_q.put(indata[:, 0].copy())

    def tts_worker():
        while True:
            text = tts_q.get()
            if text is None:
                return
            try:
                pcm_parts = []
                sample_rate = 22050
                for chunk in piper.synthesize(text):
                    pcm_parts.append(
                        np.frombuffer(chunk.audio_int16_bytes, dtype=np.int16)
                    )
                    sample_rate = chunk.sample_rate

                if pcm_parts:
                    pcm = np.concatenate(pcm_parts)
                    sd.play(pcm, samplerate=sample_rate, device=out, blocking=True)
            except Exception as e:
                print("TTS:", e, flush=True)
            finally:
                tts_q.task_done()

    threading.Thread(target=tts_worker, daemon=True).start()

    with sd.InputStream(
        samplerate=RATE,
        blocksize=BLOCK,
        channels=1,
        dtype="float32",
        device=inp,
        callback=audio_callback,
    ):
        while True:
            block = audio_q.get()
            level = rms(block)

            speech_buffer.append(block)
            max_samples = int(MAX_BUFFER_SECONDS * RATE)
            combined = np.concatenate(speech_buffer)

            if len(combined) > max_samples:
                combined = combined[-max_samples:]
                speech_buffer = [combined]

            now = time.monotonic()

            # Do not wait for the end of the sentence. Re-run Whisper frequently
            # on a short rolling window so speech can be echoed during the utterance.
            if now - last_recognition >= STEP_SECONDS and len(combined) >= int(WINDOW_SECONDS * RATE):
                last_recognition = now
                window = combined[-int(WINDOW_SECONDS * RATE):]

                if rms(window) >= START_RMS:
                    print("Listening...", end="\r", flush=True)

                    segments, _ = whisper.transcribe(
                        window,
                        language="en",
                        beam_size=1,
                        vad_filter=True,
                        condition_on_previous_text=False,
                        temperature=0.0,
                    )
                    text = " ".join(s.text.strip() for s in segments).strip()

                    if text:
                        piece, stable = new_words(recognized_stable, text)
                        if piece:
                            # Avoid tiny unstable fragments. Whole words only.
                            piece = piece.strip(" ,.!?;:")
                            if len(piece.split()) >= 1:
                                print(f"You -> Amy: {piece}", flush=True)
                                try:
                                    tts_q.put_nowait(piece)
                                except queue.Full:
                                    # Drop stale audio rather than letting delay grow.
                                    print("TTS queue full; dropping stale chunk.", flush=True)
                        recognized_stable = stable

            # When the mic has been quiet for a while, reset the transcript so
            # the next sentence starts cleanly.
            if level < END_RMS:
                if now - last_activity > 1.0:
                    recognized_stable = ""
            else:
                last_activity = now


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception as e:
        print("\nERROR:", e)
        input("Press Enter to close...")
