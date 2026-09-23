import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "cloned_voice"
CKPT = ROOT / "checkpoints_v2" / "converter"

def main():
    if len(sys.argv) != 2:
        print("Drag one WAV file onto clone.bat.")
        return 1

    source = Path(sys.argv[1]).resolve()
    if not source.is_file() or source.suffix.lower() != ".wav":
        print("ERROR: Please provide a WAV reference file.")
        return 1

    config = CKPT / "config.json"
    weights = CKPT / "checkpoint.pth"
    if not config.is_file() or not weights.is_file():
        print("ERROR: OpenVoice V2 converter files are missing.")
        print(config)
        print(weights)
        return 1

    try:
        import torch
        from openvoice.api import ToneColorConverter
    except Exception as exc:
        print("ERROR: OpenVoice or its required Python packages are not installed.")
        print(exc)
        return 1

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    print(f"Using {device}")
    print("Loading OpenVoice V2...")
    converter = ToneColorConverter(
        str(config),
        device=device,
        enable_watermark=False,
    )
    converter.load_ckpt(str(weights))

    OUT.mkdir(exist_ok=True)
    output = OUT / "voice_embedding.pth"

    print("Extracting voice embedding...")
    # Direct extraction: no web server, no speech recognition, no VAD server.
    converter.extract_se(str(source), se_save_path=str(output))

    print()
    print("DONE")
    print(f"Saved: {output}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
