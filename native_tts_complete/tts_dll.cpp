#define TTS_DLL_BUILD
#include "tts_dll.h"
#include <windows.h>
#include <string>
#include <vector>
#include <fstream>
#include <sstream>
#include <filesystem>
#include <cstdlib>
#include <cstdint>
namespace fs=std::filesystem;
static thread_local std::string g_err;
struct tts_handle { std::string model; std::string reference; };
static std::string q(const std::string&s){return "\""+s+"\"";}
#pragma pack(push,1)
struct WavHdr{char riff[4];uint32_t size;char wave[4];char fmt[4];uint32_t fmtSize;uint16_t format;uint16_t channels;uint32_t rate;uint32_t byteRate;uint16_t align;uint16_t bits;char data[4];uint32_t dataSize;};
#pragma pack(pop)
extern "C" __declspec(dllexport) tts_handle* tts_create(const char* voice_model_path){auto*p=new tts_handle;p->model=voice_model_path?voice_model_path:"";return p;}
extern "C" __declspec(dllexport) int tts_set_reference_wav(tts_handle*p,const char*wav){if(!p||!wav){g_err="bad reference WAV";return 0;}p->reference=wav;return 1;}
extern "C" __declspec(dllexport) int tts_synthesize(tts_handle*p,const char*text,float**pcm,int*samples,int*rate){
 if(!p||!text||!pcm||!samples||!rate){g_err="bad TTS arguments";return 0;}
 if(p->model.empty()){g_err="No Piper voice model path supplied";return 0;}
 fs::path exe=fs::path("piper")/"piper.exe"; if(!fs::exists(exe)){g_err="piper\\piper.exe not found; run setup_models.bat";return 0;}
 fs::path out=fs::temp_directory_path()/"voicechanger_tts.wav";fs::path in=fs::temp_directory_path()/"voicechanger_tts.txt";
 {std::ofstream f(in,std::ios::binary);f<<text<<"\n";}
 std::string cmd=q(exe.string())+" --model "+q(p->model)+" --output_file "+q(out.string())+" < "+q(in.string());
 int rc=system(cmd.c_str());fs::remove(in);if(rc!=0){g_err="Piper failed with exit code "+std::to_string(rc);return 0;}
 std::ifstream f(out,std::ios::binary);WavHdr h{};f.read((char*)&h,sizeof(h));if(!f||std::string(h.riff,4)!="RIFF"||std::string(h.wave,4)!="WAVE"||h.format!=1||h.bits!=16){g_err="Piper returned an unsupported WAV";fs::remove(out);return 0;}
 std::vector<int16_t> s(h.dataSize/2);f.read((char*)s.data(),h.dataSize);fs::remove(out);if(s.empty()){g_err="Piper returned empty audio";return 0;}
 *pcm=(float*)malloc(sizeof(float)*s.size());if(!*pcm){g_err="out of memory";return 0;}for(size_t i=0;i<s.size();++i)(*pcm)[i]=s[i]/32768.0f;*samples=(int)s.size();*rate=(int)h.rate;return 1;
}
extern "C" __declspec(dllexport) void tts_free_audio(float*p){free(p);}
extern "C" __declspec(dllexport) void tts_destroy(tts_handle*p){delete p;}
extern "C" __declspec(dllexport) const char* tts_last_error(){return g_err.c_str();}
