import argparse
import os
import sys
import traceback


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ref-audio", required=True)
    parser.add_argument("--ref-text", default="")
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    if not os.path.isfile(args.ref_audio):
        raise FileNotFoundError(f"Reference WAV not found: {args.ref_audio}")

    from f5_tts.api import F5TTS

    print("F5-TTS: loading model", flush=True)
    tts = F5TTS(model="F5TTS_v1_Base")
    print("F5-TTS: generating", flush=True)
    tts.infer(
        ref_file=args.ref_audio,
        ref_text=args.ref_text,
        gen_text=args.text,
        file_wave=args.output,
        remove_silence=False,
    )
    if not os.path.isfile(args.output) or os.path.getsize(args.output) < 44:
        raise RuntimeError("F5-TTS did not produce a valid WAV file.")
    print(f"F5-TTS: output={args.output}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"F5-TTS ERROR: {exc}", file=sys.stderr, flush=True)
        traceback.print_exc()
        sys.exit(1)
