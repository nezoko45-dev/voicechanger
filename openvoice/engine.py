import argparse
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ref-audio', required=True)
    parser.add_argument('--text', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--language', default='English')
    args = parser.parse_args()

    try:
        import torch
        from openvoice import se_extractor
        from openvoice.api import ToneColorConverter
        from melo.api import TTS
        from huggingface_hub import snapshot_download
    except Exception as exc:
        raise RuntimeError(f'OpenVoice startup dependency error: {type(exc).__name__}: {exc}') from exc

    # Windows OpenVoice builds should use CPU by default. The CUDA build of
    # PyTorch can fail at startup when a matching cuDNN DLL is not installed.
    # Users with a working CUDA setup can opt in with VOICECHANGER_OPENVOICE_DEVICE=cuda.
    requested = os.environ.get('VOICECHANGER_OPENVOICE_DEVICE', 'cpu').strip().lower()
    if requested == 'cuda' and torch.cuda.is_available():
        device = 'cuda'
    else:
        device = 'cpu'

    root = Path(os.environ.get('VOICECHANGER_OPENVOICE_HOME', Path.home() / '.voicechanger-openvoice'))
    root.mkdir(parents=True, exist_ok=True)
    model_dir = root / 'OpenVoiceV2'

    try:
        snapshot_download('myshell-ai/OpenVoiceV2', local_dir=str(model_dir))
    except Exception as exc:
        raise RuntimeError(f'Could not download OpenVoice V2 model files: {type(exc).__name__}: {exc}') from exc

    converter_dir = model_dir / 'converter'
    config = converter_dir / 'config.json'
    checkpoint = converter_dir / 'checkpoint.pth'
    if not config.exists() or not checkpoint.exists():
        raise RuntimeError(f'OpenVoice V2 converter files are missing from {converter_dir}')

    try:
        converter = ToneColorConverter(str(config), device=device)
        converter.load_ckpt(str(checkpoint))

        language = args.language
        if language.lower() not in {'english', 'spanish', 'french', 'chinese', 'japanese', 'korean'}:
            language = 'English'

        melo = TTS(language=language, device=device)
        speaker_ids = melo.hps.data.spk2id
        if not speaker_ids:
            raise RuntimeError('MeloTTS did not provide a base speaker.')
        speaker_key = next(iter(speaker_ids.keys()))

        tmp = root / 'base_speech.wav'
        melo.tts_to_file(args.text, speaker_ids[speaker_key], str(tmp), speed=1.0)

        target_se, _ = se_extractor.get_se(
            str(args.ref_audio), converter,
            target_dir=str(root / 'processed'), vad=True
        )
        source_se, _ = se_extractor.get_se(
            str(tmp), converter,
            target_dir=str(root / 'processed'), vad=True
        )

        converter.convert(
            audio_src_path=str(tmp),
            src_se=source_se,
            tgt_se=target_se,
            output_path=str(args.output),
            message='@VoiceChanger',
        )
    except Exception as exc:
        raise RuntimeError(f'OpenVoice V2 generation error ({device}): {type(exc).__name__}: {exc}') from exc

    print(f'OPENVOICE_OK {args.output}')


if __name__ == '__main__':
    main()
