#include <windows.h>
#include <mmsystem.h>
#include <iostream>
#include <vector>
#include <string>
#include <cmath>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <cstring>
#include <algorithm>
#include "whisper_dll.h"
#include "tts_dll.h"
#pragma comment(lib,"winmm.lib")
struct MicState{std::mutex m;std::condition_variable cv;std::vector<float> pcm;};
static void CALLBACK mic_cb(HWAVEIN h,UINT msg,DWORD_PTR inst,DWORD_PTR p1,DWORD_PTR){if(msg!=WIM_DATA)return;auto*s=(MicState*)inst;auto*w=(WAVEHDR*)p1;int n=(int)(w->dwBytesRecorded/2);{std::lock_guard<std::mutex>lk(s->m);for(int i=0;i<n;i++)s->pcm.push_back(((int16_t*)w->lpData)[i]/32768.0f);}waveInAddBuffer(h,w,sizeof(WAVEHDR));s->cv.notify_one();}
static void list_devices(){WAVEINCAPSA ic{};std::cout<<"\nMicrophones:\n";for(UINT i=0;i<waveInGetNumDevs();++i)if(!waveInGetDevCapsA(i,&ic,sizeof(ic)))std::cout<<"  ["<<i<<"] "<<ic.szPname<<"\n";WAVEOUTCAPSA oc{};std::cout<<"Outputs:\n";for(UINT i=0;i<waveOutGetNumDevs();++i)if(!waveOutGetDevCapsA(i,&oc,sizeof(oc)))std::cout<<"  ["<<i<<"] "<<oc.szPname<<"\n";}
static bool play(int dev,const float*p,int n,int rate){std::vector<int16_t>s(n);for(int i=0;i<n;i++){float x=std::clamp(p[i],-1.0f,1.0f);s[i]=(int16_t)(x*32767);}HWAVEOUT out=nullptr;WAVEFORMATEX f{};f.wFormatTag=WAVE_FORMAT_PCM;f.nChannels=1;f.nSamplesPerSec=(DWORD)rate;f.wBitsPerSample=16;f.nBlockAlign=2;f.nAvgBytesPerSec=rate*2;if(waveOutOpen(&out,(UINT_PTR)dev,&f,0,0,CALLBACK_NULL)!=MMSYSERR_NOERROR){std::cerr<<"Output device could not be opened.\n";return false;}WAVEHDR h{};h.lpData=(LPSTR)s.data();h.dwBufferLength=(DWORD)(s.size()*2);waveOutPrepareHeader(out,&h,sizeof(h));waveOutWrite(out,&h,sizeof(h));while(!(h.dwFlags&WHDR_DONE))Sleep(5);waveOutUnprepareHeader(out,&h,sizeof(h));waveOutClose(out);return true;}
int main(){std::cout<<"=== Native Mic -> Whisper -> TTS ===\n";list_devices();int mic,outdev;std::cout<<"\nEnter microphone index: ";std::cin>>mic;std::cout<<"Enter output index: ";std::cin>>outdev;std::string model="piper/en_US-lessac-medium.onnx",ref;std::cout<<"Reference WAV path (optional): ";std::cin>>ref;auto wh=wh_create("models/ggml-tiny.en.bin");if(!wh){std::cerr<<"Whisper: "<<wh_last_error()<<"\n";return 2;}auto tts=tts_create(model.c_str());if(!tts){std::cerr<<"TTS init failed\n";return 3;}if(!ref.empty())tts_set_reference_wav(tts,ref.c_str());WAVEFORMATEX f{};f.wFormatTag=WAVE_FORMAT_PCM;f.nChannels=1;f.nSamplesPerSec=16000;f.wBitsPerSample=16;f.nBlockAlign=2;f.nAvgBytesPerSec=32000;MicState st;HWAVEIN in=nullptr;if(waveInOpen(&in,(UINT)mic,&f,(DWORD_PTR)mic_cb,(DWORD_PTR)&st,CALLBACK_FUNCTION)!=MMSYSERR_NOERROR){std::cerr<<"Could not open microphone.\n";return 4;}std::vector<std::vector<char>>bufs(4,std::vector<char>(6400));std::vector<WAVEHDR>hs(4);for(int i=0;i<4;i++){hs[i].lpData=bufs[i].data();hs[i].dwBufferLength=(DWORD)bufs[i].size();waveInPrepareHeader(in,&hs[i],sizeof(WAVEHDR));waveInAddBuffer(in,&hs[i],sizeof(WAVEHDR));}waveInStart(in);std::vector<float>utter;size_t consumed=0;int quiet=0;std::cout<<"\nListening... speak, then pause.\n";for(;;){std::unique_lock<std::mutex>lk(st.m);st.cv.wait_for(lk,std::chrono::milliseconds(100));if(st.pcm.size()<consumed+1600)continue;size_t take=1600;float e=0;for(size_t i=0;i<take;i++){float x=st.pcm[consumed+i];e+=x*x;utter.push_back(x);}consumed+=take;lk.unlock();e=sqrt(e/take);if(e<0.008f)quiet+=100;else quiet=0;if(utter.size()>=8000&&quiet>=500){char text[2048]{};if(wh_transcribe_f32(wh,utter.data(),(int)utter.size(),text,sizeof(text))&&strlen(text)>1){std::cout<<"> "<<text<<"\n";float*a=nullptr;int n=0,rate=0;if(tts_synthesize(tts,text,&a,&n,&rate)){play(outdev,a,n,rate);tts_free_audio(a);}else std::cerr<<"TTS: "<<tts_last_error()<<"\n";}utter.clear();quiet=0;}}}
