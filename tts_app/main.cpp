#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmsystem.h>
#include <commdlg.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>
#include <thread>
#include <mutex>
#include <atomic>
#include <deque>
#include <condition_variable>
#include <algorithm>
#pragma comment(lib, "winmm.lib")
#pragma comment(lib, "comdlg32.lib")

using whisper_init_fn = void* (__cdecl*)(const char*);
using whisper_transcribe_fn = int (__cdecl*)(void*, const float*, int, char*, int);
using whisper_free_fn = void (__cdecl*)(void*);
using tts_init_fn = void* (__cdecl*)();
using tts_clone_fn = int (__cdecl*)(void*, const float*, int, int);
using tts_synth_fn = int (__cdecl*)(void*, const char*, float**, int*, int*);
using tts_free_audio_fn = void (__cdecl*)(void*, float*);
using tts_free_fn = void (__cdecl*)(void*);

struct Engines {
    HMODULE whisperDll=nullptr, ttsDll=nullptr;
    void* whisper=nullptr; void* tts=nullptr;
    whisper_init_fn whisper_init=nullptr; whisper_transcribe_fn whisper_transcribe=nullptr; whisper_free_fn whisper_free=nullptr;
    tts_init_fn tts_init=nullptr; tts_clone_fn tts_clone=nullptr; tts_synth_fn tts_synth=nullptr; tts_free_audio_fn tts_free_audio=nullptr; tts_free_fn tts_free=nullptr;
};

static bool loadEngines(Engines& e, std::string& err) {
    e.whisperDll=LoadLibraryW(L"whisper.dll"); if(!e.whisperDll){err="whisper.dll not found beside the app.";return false;}
    e.ttsDll=LoadLibraryW(L"tts.dll"); if(!e.ttsDll){err="tts.dll not found beside the app.";return false;}
#define W(name) e.name=reinterpret_cast<decltype(e.name)>(GetProcAddress(e.whisperDll,#name)); if(!e.name){err="whisper.dll missing export: " #name;return false;}
    W(whisper_init) W(whisper_transcribe) W(whisper_free)
#undef W
#define T(name) e.name=reinterpret_cast<decltype(e.name)>(GetProcAddress(e.ttsDll,#name)); if(!e.name){err="tts.dll missing export: " #name;return false;}
    T(tts_init) T(tts_clone) T(tts_synth) T(tts_free_audio) T(tts_free)
#undef T
    return true;
}

static bool readWav(const std::wstring& path,std::vector<float>& mono,int& rate,std::string& err){
    std::ifstream f(path,std::ios::binary); if(!f){err="Could not open reference WAV.";return false;}
    char riff[4],wave[4]; uint32_t size=0; f.read(riff,4);f.read((char*)&size,4);f.read(wave,4);
    if(std::string(riff,4)!="RIFF"||std::string(wave,4)!="WAVE"){err="Reference is not a RIFF/WAVE file.";return false;}
    uint16_t channels=0,bits=0; uint16_t format=0; uint32_t dataSize=0; std::vector<char> data; bool fmt=false;
    while(f&&!dataSize){char id[4];uint32_t n=0;if(!f.read(id,4)||!f.read((char*)&n,4))break;std::string s(id,4);if(s=="fmt "){f.read((char*)&format,2);f.read((char*)&channels,2);f.read((char*)&rate,4);f.seekg(6,std::ios::cur);f.read((char*)&bits,2);if(n>16)f.seekg(n-16,std::ios::cur);fmt=true;}else if(s=="data"){data.resize(n);f.read(data.data(),n);dataSize=n;}else f.seekg(n,std::ios::cur);}
    if(!fmt||!dataSize||format!=1||bits!=16||!channels){err="Only PCM16 WAV references are supported.";return false;}
    size_t frames=data.size()/(channels*2);mono.resize(frames);const int16_t* p=(const int16_t*)data.data();for(size_t i=0;i<frames;i++){double x=0;for(int c=0;c<channels;c++)x+=p[i*channels+c]/32768.0;mono[i]=(float)(x/channels);}return true;
}

static void writeWav(const std::wstring& path,const float* pcm,int n,int rate){std::ofstream f(path,std::ios::binary);uint32_t bytes=n*2,riff=36+bytes;uint16_t fmt=1,ch=1,bits=16;uint32_t br=rate*2;uint16_t ba=2;f.write("RIFF",4);f.write((char*)&riff,4);f.write("WAVEfmt ",8);uint32_t fs=16;f.write((char*)&fs,4);f.write((char*)&fmt,2);f.write((char*)&ch,2);f.write((char*)&rate,4);f.write((char*)&br,4);f.write((char*)&ba,2);f.write((char*)&bits,2);f.write("data",4);f.write((char*)&bytes,4);for(int i=0;i<n;i++){int16_t v=(int16_t)(std::clamp(pcm[i],-1.f,1.f)*32767);f.write((char*)&v,2);}}

static std::wstring chooseWav(){OPENFILENAMEW o{};wchar_t buf[MAX_PATH]={};o.lStructSize=sizeof(o);o.lpstrFilter=L"WAV files\0*.wav\0All files\0*.*\0";o.lpstrFile=buf;o.nMaxFile=MAX_PATH;o.Flags=OFN_FILEMUSTEXIST|OFN_PATHMUSTEXIST;if(GetOpenFileNameW(&o))return buf;return L"";}

int wmain(){std::wcout<<L"\nNative Mic -> Whisper -> WAV TTS\n\n";Engines e;std::string err;if(!loadEngines(e,err)){std::cerr<<err<<"\n";return 2;}e.whisper=e.whisper_init("models/whisper.bin");e.tts=e.tts_init();if(!e.whisper||!e.tts){std::cerr<<"Model engine initialization failed.\n";return 3;}
std::wstring wav=chooseWav();if(wav.empty()){std::cout<<"No reference WAV selected.\n";return 4;}std::vector<float> ref;int rr=0;if(!readWav(wav,ref,rr,err)){std::cerr<<err<<"\n";return 5;}if(e.tts_clone(e.tts,ref.data(),(int)ref.size(),rr)!=0){std::cerr<<"TTS reference cloning failed.\n";return 6;}std::cout<<"Reference voice loaded.\n";
std::cout<<"This host is intentionally DLL-driven. The next stage is the live microphone capture/Whisper loop.\n";
std::cout<<"Press ENTER to exit.\n";std::cin.get();e.whisper_free(e.whisper);e.tts_free(e.tts);FreeLibrary(e.whisperDll);FreeLibrary(e.ttsDll);return 0;}
