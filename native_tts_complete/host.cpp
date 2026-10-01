#include <windows.h>
#include <mmsystem.h>
#include <iostream>
#include <vector>
#include <string>
#include <cmath>
#include <thread>
#include <mutex>
#include <condition_variable>
#include "whisper_dll.h"
#include "tts_dll.h"
#pragma comment(lib,"winmm.lib")
struct MicState{std::mutex m;std::condition_variable cv;std::vector<float> pcm;bool running=true;};
static void CALLBACK mic_cb(HWAVEIN,UINT msg,DWORD_PTR inst,DWORD_PTR p1,DWORD_PTR){if(msg!=WIM_DATA)return;auto*s=(MicState*)inst;auto*h=(WAVEHDR*)p1;int n=(int)(h->dwBytesRecorded/2);{std::lock_guard<std::mutex>lk(s->m);for(int i=0;i<n;i++)s->pcm.push_back(((int16_t*)h->lpData)[i]/32768.0f);}s->cv.notify_one();}
static void list_devices(){WAVEINCAPSA ic{};std::cout<<"Microphones:\n";for(UINT i=0;i<waveInGetNumDevs();++i)if(!waveInGetDevCapsA(i,&ic,sizeof(ic)))std::cout<<"  ["<<i<<"] "<<ic.szPname<<"\n";WAVEOUTCAPSA oc{};std::cout<<"Outputs:\n";for(UINT i=0;i<waveOutGetNumDevs();++i)if(!waveOutGetDevCapsA(i,&oc,sizeof(oc)))std::cout<<"  ["<<i<<"] "<<oc.szPname<<"\n";}
static bool play(int dev,const float*p,int n,int rate){std::vector<int16_t>s(n);for(int i=0;i<n;i++){float x=p[i];if(x>1)x=1;if(x<-1)x=-1;s[i]=(int16_t)(x*32767);}HWAVEOUT out=nullptr;WAVEFORMATEX f{};f.wFormatTag=WAVE_FORMAT_PCM;f.nChannels=1;f.nSamplesPerSec=rate;f.wBitsPerSample=16;f.nBlockAlign=2;f.nAvgBytesPerSec=rate*2;if(waveOutOpen(&out,dev,&f,0,0,CALLBACK_NULL)!=MMSYSERR_NOERROR)return false;WAVEHDR h{};h.lpData=(LPSTR)s.data();h.dwBufferLength=(DWORD)(s.size()*2);waveOutPrepareHeader(out,&h,sizeof(h));waveOutWrite(out,&h,sizeof(h));while(!(h.dwFlags&WHDR_DONE))Sleep(5);waveOutUnprepareHeader(out,&h,sizeof(h));waveOutClose(out);return true;}
int main(int argc,char**argv){std::cout<<"Native Mic -> Whisper -> TTS\n\n";list_devices();if(argc<4){std::cout<<"Usage: tts_app.exe <mic-index> <output-index> <voice-model.onnx> [reference.wav]\n";return 0;}int mic=atoi(argv[1]),outdev=atoi(argv[2]);std::string model=argv[3];WhState_dummy: ;auto wh=wh_create("models/ggml-tiny.en.bin");if(!wh){std::cerr<<"Whisper: "<<wh_last_error()<<"\n";return 2;}auto tts=tts_create(model.c_str());if(!tts){std::cerr<<"TTS init failed\n";return 3;}if(argc>=5)tts_set_reference_wav(tts,argv[4]);
 WAVEFORMATEX f{};f.wFormatTag=WAVE_FORMAT_PCM;f.nChannels=1;f.nSamplesPerSec=16000;f.wBitsPerSample=16;f.nBlockAlign=2;f.nAvgBytesPerSec=32000;MicState st;HWAVEIN in=nullptr;if(waveInOpen(&in,mic,&f,(DWORD_PTR)mic_cb,(DWORD_PTR)&st,CALLBACK_FUNCTION)!=MMSYSERR_NOERROR){std::cerr<<"Could not open microphone. Try another index.\n";return 4;}std::vector<std::vector<char>> bufs(4,std::vector<char>(6400));std::vector<WAVEHDR> hs(4);for(int i=0;i<4;i++){hs[i].lpData=bufs[i].data();hs[i].dwBufferLength=(DWORD)bufs[i].size();waveInPrepareHeader(in,&hs[i],sizeof(WAVEHDR));waveInAddBuffer(in,&hs[i],sizeof(WAVEHDR));}waveInStart(in);std::vector<float> utter;size_t consumed=0;int quiet=0;std::cout<<"Listening... Ctrl+C to stop.\n";while(true){std::unique_lock<std::mutex>lk(st.m);st.cv.wait_for(lk,std::chrono::milliseconds(100));if(st.pcm.size()<consumed+1600)continue;size_t avail=st.pcm.size()-consumed;size_t take=std::min<size_t>(avail,1600);float energy=0;for(size_t i=0;i<take;i++){float x=st.pcm[consumed+i];energy+=x*x;}energy=sqrt(energy/take);for(size_t i=0;i<take;i++)utter.push_back(st.pcm[consumed+i]);consumed+=take;lk.unlock();if(energy<0.008f){quiet+=100;}else quiet=0;if(utter.size()>=8000&&quiet>=500){char text[2048]{};if(wh_transcribe_f32(wh,utter.data(),(int)utter.size(),text,sizeof(text))&&strlen(text)>1){std::cout<<"> "<<text<<"\n";float*audio=nullptr;int n=0,rate=0;if(tts_synthesize(tts,text,&audio,&n,&rate)){play(outdev,audio,n,rate);tts_free_audio(audio);}else std::cerr<<"TTS: "<<tts_last_error()<<"\n";}utter.clear();quiet=0;}}
}
