#define TTS_DLL_BUILD
#include "tts_dll.h"
#include <windows.h>
#include <string>
#include <vector>
#include <fstream>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <propvarutil.h>
#include <wrl/client.h>

static thread_local std::string g_err;
struct tts_handle { std::string voice; std::string reference; };
static std::wstring widen(const char* s){int n=MultiByteToWideChar(CP_UTF8,0,s,-1,nullptr,0);std::wstring w(n,L'\0');MultiByteToWideChar(CP_UTF8,0,s,-1,w.data(),n);return w;}
extern "C" __declspec(dllexport) tts_handle* tts_create(const char* voice_model_path){auto*p=new tts_handle;p->voice=voice_model_path?voice_model_path:"";return p;}
extern "C" __declspec(dllexport) int tts_set_reference_wav(tts_handle*p,const char*wav){if(!p||!wav){g_err="bad reference WAV";return 0;}p->reference=wav;return 1;}
extern "C" __declspec(dllexport) int tts_synthesize(tts_handle*,const char*,float**,int*,int*){g_err="TTS model backend not linked. Install/build a voice-cloning backend that implements tts_synthesize; the reference-WAV API is ready.";return 0;}
extern "C" __declspec(dllexport) void tts_free_audio(float*p){free(p);}
extern "C" __declspec(dllexport) void tts_destroy(tts_handle*p){delete p;}
extern "C" __declspec(dllexport) const char* tts_last_error(){return g_err.c_str();}
