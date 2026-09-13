MODEL_ID = 'Qwen/Qwen3-TTS-12Hz-0.6B-Base'

_model = None

def get_model():
    global _model
    if _model is not None:
        return _model
    import torch
    from qwen_tts import Qwen3TTSModel
    device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
    dtype = torch.bfloat16 if device.startswith('cuda') else torch.float32
    _model = Qwen3TTSModel.from_pretrained(MODEL_ID, device_map=device, dtype=dtype)
    return _model

def clone_to_wav(text, reference_audio, reference_text=''):
    import soundfile as sf
    model = get_model()
    kwargs = {
        'text': text,
        'language': 'English',
        'ref_audio': reference_audio,
    }
    if reference_text.strip():
        kwargs['ref_text'] = reference_text.strip()
    else:
        kwargs['x_vector_only_mode'] = True
    wavs, sample_rate = model.generate_voice_clone(**kwargs)
    return wavs[0], sample_rate
