#pragma once
#ifdef TTS_DLL_BUILD
#define TTS_API extern "C" __declspec(dllexport)
#else
#define TTS_API extern "C" __declspec(dllimport)
#endif
struct tts_handle;
TTS_API tts_handle* tts_create(const char* voice_model_path);
TTS_API int tts_set_reference_wav(tts_handle*, const char* wav_path);
TTS_API int tts_synthesize(tts_handle*, const char* text, float** pcm, int* samples, int* sample_rate);
TTS_API void tts_free_audio(float* pcm);
TTS_API void tts_destroy(tts_handle*);
TTS_API const char* tts_last_error();
