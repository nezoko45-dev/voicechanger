#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <filesystem>
#include <iostream>
#include <mutex>
#include <string>
#include <vector>
#include <algorithm>
#include "dvc/dvc.h"
#pragma comment(lib, "ws2_32.lib")

namespace fs = std::filesystem;
static dvc_context* g_ctx = nullptr;
static HMODULE g_dll = nullptr;
static std::mutex g_mutex;
static std::string g_error;

#define DVC_FN(name) decltype(&name) p_##name = nullptr
DVC_FN(dvc_create); DVC_FN(dvc_destroy); DVC_FN(dvc_default_config);
DVC_FN(dvc_default_model_config); DVC_FN(dvc_load_model); DVC_FN(dvc_process); DVC_FN(dvc_last_error);
#undef DVC_FN

static bool load_exports(){
    g_dll = LoadLibraryW(L"voicechanger.dll");
    if(!g_dll){ g_error="LoadLibrary voicechanger.dll failed"; return false; }
#define LOAD(name) do { p_##name = reinterpret_cast<decltype(p_##name)>(GetProcAddress(g_dll, #name)); if(!p_##name){g_error="Missing DLL export: " #name; return false;} } while(0)
    LOAD(dvc_create); LOAD(dvc_destroy); LOAD(dvc_default_config); LOAD(dvc_default_model_config); LOAD(dvc_load_model); LOAD(dvc_process); LOAD(dvc_last_error);
#undef LOAD
    return true;
}

static std::string url_decode(std::string s){
    std::string o; o.reserve(s.size());
    for(size_t i=0;i<s.size();++i){ if(s[i]=='+'){o+=' ';continue;} if(s[i]=='%'&&i+2<s.size()){char h[3]={s[i+1],s[i+2],0};o.push_back((char)strtol(h,nullptr,16));i+=2;}else o+=s[i]; }
    return o;
}
static std::string query_value(const std::string& target,const std::string& key){
    auto q=target.find('?'); if(q==std::string::npos)return {};
    auto s=target.substr(q+1), needle=key+"="; size_t p=0;
    while(p<s.size()){size_t e=s.find('&',p); if(e==std::string::npos)e=s.size(); if(s.compare(p,needle.size(),needle)==0)return url_decode(s.substr(p+needle.size(),e-p-needle.size())); p=e+1;}
    return {};
}
static void send_http(SOCKET s,int code,const char* type,const std::vector<char>& body){
    std::string h="HTTP/1.1 "+std::to_string(code)+(code==200?" OK":" Bad Request")+"\r\nContent-Type: "+type+"\r\nContent-Length: "+std::to_string(body.size())+"\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Methods: GET,POST,OPTIONS\r\nConnection: close\r\n\r\n";
    send(s,h.data(),(int)h.size(),0); if(!body.empty())send(s,body.data(),(int)body.size(),0);
}
static void send_text(SOCKET s,const std::string& x,int code=200){std::vector<char>b(x.begin(),x.end());send_http(s,code,"application/json",b);}
static bool load_model(const std::string& voice,const std::string& content,const std::string& pitch){
    std::lock_guard<std::mutex> lock(g_mutex);
    if(!g_ctx){ dvc_config cfg{}; p_dvc_default_config(&cfg); cfg.sample_rate=48000; cfg.block_size=4800; cfg.context_samples=24000; cfg.crossfade_samples=480; cfg.search_samples=240; cfg.threads=std::max(1u,std::thread::hardware_concurrency()/2); auto st=p_dvc_create(&cfg,&g_ctx); if(st!=DVC_OK){g_error=p_dvc_last_error();return false;} }
    dvc_model_config m{}; p_dvc_default_model_config(&m); m.voice_path=voice.c_str(); m.content_path=content.c_str(); m.pitch_path=pitch.c_str(); m.sample_rate=40000; m.feature_dimension=768; m.speaker_count=1;
    auto st=p_dvc_load_model(g_ctx,&m); if(st!=DVC_OK){g_error=p_dvc_last_error();return false;} g_error.clear(); return true;
}
static void handle(SOCKET s){
    std::vector<char> buf(65536); int n=recv(s,buf.data(),(int)buf.size()-1,0); if(n<=0)return; buf[n]=0; std::string req(buf.data(),n);
    auto line=req.find("\r\n"); if(line==std::string::npos)return; std::string first=req.substr(0,line); auto sp=first.find(' '); auto sp2=first.find(' ',sp+1); if(sp==std::string::npos||sp2==std::string::npos)return; std::string method=first.substr(0,sp),target=first.substr(sp+1,sp2-sp-1);
    if(method=="OPTIONS"){send_text(s,"{}",200);return;}
    if(target.rfind("/status",0)==0){std::string j="{\"ready\":"+(g_ctx?"true":"false")+",\"error\":\""+g_error+"\"}";send_text(s,j);return;}
    if(target.rfind("/load",0)==0){auto v=query_value(target,"voice"),c=query_value(target,"content"),p=query_value(target,"pitch"); if(v.empty()||c.empty()||p.empty()){send_text(s,"{\"ok\":false,\"error\":\"missing model path\"}",400);return;} bool ok=load_model(v,c,p); send_text(s,ok?"{\"ok\":true}":"{\"ok\":false,\"error\":\"model load failed\"}",ok?200:400);return;}
    if(target.rfind("/process",0)==0 && method=="POST"){
        auto he=req.find("\r\n\r\n"); if(he==std::string::npos)return; size_t bodyStart=he+4; size_t cl=req.find("Content-Length:"); size_t want=0; if(cl!=std::string::npos){auto e=req.find("\r\n",cl); want=(size_t)strtoull(req.substr(cl+15,e-cl-15).c_str(),nullptr,10);} std::vector<char> body; body.insert(body.end(),req.begin()+bodyStart,req.end()); while(body.size()<want){char x[65536];int k=recv(s,x,(int)std::min<size_t>(sizeof(x),want-body.size()),0);if(k<=0)break;body.insert(body.end(),x,x+k);} if(body.size()!=want||want%sizeof(float)!=0){send_text(s,"{\"error\":\"invalid PCM body\"}",400);return;}
        std::lock_guard<std::mutex> lock(g_mutex); if(!g_ctx){send_text(s,"{\"error\":\"model not loaded\"}",400);return;} size_t count=want/sizeof(float); std::vector<float> out(count); size_t written=0; auto st=p_dvc_process(g_ctx,reinterpret_cast<const float*>(body.data()),count,out.data(),count,&written); if(st!=DVC_OK||written!=count){send_text(s,"{\"error\":\"conversion failed\"}",500);return;} std::vector<char> result(reinterpret_cast<char*>(out.data()),reinterpret_cast<char*>(out.data())+written*sizeof(float)); send_http(s,200,"application/octet-stream",result); return;
    }
    send_text(s,"{\"error\":\"not found\"}",404);
}
int main(){
    if(!load_exports()){std::cerr<<g_error<<"\n";return 2;}
    WSADATA w{}; if(WSAStartup(MAKEWORD(2,2),&w)!=0)return 3; SOCKET srv=socket(AF_INET,SOCK_STREAM,IPPROTO_TCP); if(srv==INVALID_SOCKET)return 4; sockaddr_in a{};a.sin_family=AF_INET;a.sin_addr.s_addr=htonl(INADDR_LOOPBACK);a.sin_port=htons(8765); if(bind(srv,(sockaddr*)&a,sizeof(a))==SOCKET_ERROR||listen(srv,16)==SOCKET_ERROR)return 5;
    std::cout<<"Native RVC web bridge listening on http://127.0.0.1:8765\n";
    while(true){SOCKET c=accept(srv,nullptr,nullptr);if(c==INVALID_SOCKET)break;handle(c);closesocket(c);} closesocket(srv);WSACleanup();return 0;
}
