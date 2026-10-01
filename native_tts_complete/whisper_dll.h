#pragma once
#ifdef WHISPER_DLL_BUILD
#define WH_API extern "C" __declspec(dllexport)
#else
#define WH_API extern "C" __declspec(dllimport)
#endif
struct wh_handle;
WH_API wh_handle* wh_create(const char* model_path);
WH_API int wh_transcribe_f32(wh_handle*, const float* pcm16k, int samples, char* text, int text_capacity);
WH_API void wh_destroy(wh_handle*);
WH_API const char* wh_last_error();
