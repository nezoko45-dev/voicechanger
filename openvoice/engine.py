import argparse
import os
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ref-audio', required=True)
    parser.add_argument('--text', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--language', default='English')
    args = parser.parse_args()

    import torch
    from openvoice import se_extractor
    from openvoice.api import ToneColorConverter
    from melo.api import TTS

    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    root = Path(os.environ.get('VOICECHANGER_OPENVOICE_HOME', Path.home() / '.voicechanger-openvoice'))
    root.mkdir(parents=True, exist_ok=True)

    # OpenVoice V2 checkpoints are downloaded from the official Hugging Face
    # model repository on first use. No API key is required.
    try:
        from huggingface_hub import snapshot_download
        model_dir = Path(snapshot_download('myshell-ai/OpenVoiceV2', local_dir=str(root / 'OpenVoiceV2')))
    except Exception as exc:
        raise RuntimeError(f'Could not download OpenVoice V2 model files: {exc}') from exc

    converter_dir = model_dir / 'converter'
    converter = ToneColorConverter(str(converter_dir / 'config.json'), device=device)
    converter.load_ckpt(str(converter_dir / 'checkpoint.pth'))

    language = args.language
    if language.lower() not in {'english', 'spanish', 'french', 'chinese', 'japanese', 'korean'}:
        language = 'English'

    # MeloTTS supplies the local base TTS voice; OpenVoice then transfers the
    # reference speaker's tone color onto that generated speech.
    melo = TTS(language=language, device=device)
    speaker_ids = melo.hps.data.spk2id
    speaker_key = next(iter(speaker_ids.keys()))
    source_se = melo.hps.data.spk2id[speaker_key]
    speaker_ids_path = root / 'melo_speaker_ids.txt'
    speaker_ids_path.write_text('\n'.join(speaker_ids.keys()), encoding='utf-8')

    # MeloTTS writes a temporary base-speaker WAV. We use the first available
    # speaker because OpenVoice's tone-color converter performs the cloning.
    tmp = root / 'base_speech.wav'
    melo.tts_to_file(args.text, melo.hps.data.spk2id[speaker_key], str(tmp), speed=1.0)

    target_se, _ = se_extractor.get_se(str(args.ref_audio), converter, target_dir=str(root / 'processed'), vad=True)
    # MeloTTS output has its own speaker embedding; use the converter's source
    # embedding extracted from the generated base speech.
    source_se2, _ = se_extractor.get_se(str(tmp), converter, target_dir=str(root / 'processed'), vad=True)

    converter.convert(
        audio_src_path=str(tmp),
        src_se=source_se2,
        tgt_se=target_se,
        output_path=str(args.output),
        message='@VoiceChanger',
    )
    print(f'OPENVOICE_OK {args.output}')


if __name__ == '__main__':
    main()
