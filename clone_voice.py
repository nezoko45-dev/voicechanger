import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "cloned_voice"
CKPT = ROOT / "checkpoints_v2" / "converter"

def main():
    if len(sys.argv) < 2:
        print("Drag a WAV file onto clone.bat.")
        return 1

    source = Path(sys.argv[1]).resolve()
    if not source.exists():
        print(f"ERROR: File not found: {source}")
        return 1
    if source.suffix.lower() != ".wav":
        print("ERROR: The reference must be a .wav file.")
        return 1

    config = CKPT / "config.json"
    weights = CKPT / "checkpoint.pth"
    if not config.exists() or not weights.exists():
        print("ERROR: OpenVoice V2 converter checkpoint is missing.")
        print(f"Expected: {config}")
        print(f"Expected: {weights}")
        return 1

    try:
        import torch
        from openvoice import se_extractor
        from openvoice.api import ToneColorConverter
    except Exception as exc:
        print("ERROR: OpenVoice dependencies are not installed.")
        print(exc)
        return 1

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")
    print("Loading OpenVoice V2 converter...")

    converter = ToneColorConverter(str(config), device=device)
    converter.load_ckpt(str(weights))

    OUT.mkdir(exist_ok=True)
    processed = OUT / "processed"
    processed.mkdir(exist_ok=True)

    print("Extracting voice embedding...")
    target_se, _ = se_extractor.get_se(
        str(source),
        converter,
        target_dir=str(processed),
        vad=True,
    )

    output = OUT / "voice_embedding.pth"
    torch.save(target_se.detach().cpu(), output)

    print()
    print("SUCCESS!")
    print(f"Voice embedding: {output}")
    print("This is the reusable OpenVoice tone-color embedding.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
