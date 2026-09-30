#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/* Returns 0 on success, non-zero on failure. */
__declspec(dllexport) int VC_ConvertWav(
    const wchar_t* input_wav,
    const wchar_t* output_wav,
    const wchar_t* rvc_model,
    const wchar_t* embedder_model,
    const wchar_t* f0_model,
    const wchar_t* provider,
    float pitch_shift,
    int speaker_id);

/* Starts native RVC microphone -> speaker conversion and waits for it to exit. */
__declspec(dllexport) int VC_RunRealtime(
    const wchar_t* rvc_model,
    const wchar_t* embedder_model,
    const wchar_t* f0_model,
    const wchar_t* input_device,
    const wchar_t* output_device,
    const wchar_t* provider,
    int chunk_ms,
    int extra_convert_ms,
    float pitch_shift,
    int speaker_id);

/* Returns a thread-local UTF-16 error message. */
__declspec(dllexport) const wchar_t* VC_GetLastErrorMessage(void);

#ifdef __cplusplus
}
#endif
