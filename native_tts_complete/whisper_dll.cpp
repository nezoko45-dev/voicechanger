#define WHISPER_DLL_BUILD
#include "whisper_dll.h"
#include <windows.h>
#include <string>
#include <algorithm>
#include <thread>
#include <cstring>
#include "whisper.h"
struct wh_handle { whisper_context* ctx{}; };
static thread_local std::string g_err;
extern "C" __declspec(dllexport) wh_handle* wh_create(const char* model_path){auto*h=new wh_handle;auto p=whisper_context_default_params();h->ctx=whisper_init_from_file_with_params(model_path,p);if(!h->ctx){g_err="Whisper model could not be loaded";delete h;return nullptr;}return h;}
extern "C" __declspec(dllexport) int wh_transcribe_f32(wh_handle*h,const float*pcm,int samples,char*out,int cap){if(!h||!h->ctx||!pcm||samples<=0||!out||cap<2){g_err="invalid Whisper arguments";return 0;}auto p=whisper_full_default_params(WHISPER_SAMPLING_GREEDY);p.print_progress=false;p.print_realtime=false;p.print_timestamps=false;p.single_segment=false;p.language="en";p.n_threads=(int)std::max(1u,std::thread::hardware_concurrency()/2);if(whisper_full(h->ctx,p,pcm,samples)!=0){g_err="whisper_full failed";return 0;}std::string s;int n=whisper_full_n_segments(h->ctx);for(int i=0;i<n;i++)s+=whisper_full_get_segment_text(h->ctx,i);if((int)s.size()+1>cap){g_err="transcript buffer too small";return 0;}memcpy(out,s.c_str(),s.size()+1);return 1;}
extern "C" __declspec(dllexport) void wh_destroy(wh_handle*h){if(h){if(h->ctx)whisper_free(h->ctx);delete h;}}
extern "C" __declspec(dllexport) const char* wh_last_error(){return g_err.c_str();}
