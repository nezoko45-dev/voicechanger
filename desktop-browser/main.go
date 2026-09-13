package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

//go:embed web/index.html
var webFS embed.FS

const replicateVersion = "d548923c9d7fc9330a3b7c7f9e2f91b2ee90c83311a351dfcd32af353799223d"

type Config struct { DeepgramKey string; ReplicateKey string }
var cfg struct { sync.RWMutex; Config }

type prediction struct { ID string `json:"id"`; Status string `json:"status"`; Output interface{} `json:"output"`; Error interface{} `json:"error"`; URLs struct { Get string `json:"get"` } `json:"urls"` }

func writeJSON(w http.ResponseWriter, code int, v interface{}) { w.Header().Set("Content-Type", "application/json"); w.Header().Set("Cache-Control", "no-store"); w.WriteHeader(code); _ = json.NewEncoder(w).Encode(v) }
func configSnapshot() Config { cfg.RLock(); defer cfg.RUnlock(); return cfg.Config }

func deepgramToken(w http.ResponseWriter) {
	c := configSnapshot(); if c.DeepgramKey == "" { writeJSON(w,400,map[string]string{"error":"Deepgram API key is not configured"}); return }
	req,_:=http.NewRequest("POST","https://api.deepgram.com/v1/auth/grant",bytes.NewBufferString(`{"ttl_seconds":3600}`)); req.Header.Set("Authorization","Token "+c.DeepgramKey); req.Header.Set("Content-Type","application/json")
	resp,err:=http.DefaultClient.Do(req); if err!=nil { writeJSON(w,502,map[string]string{"error":err.Error()}); return }; defer resp.Body.Close()
	if resp.StatusCode<200||resp.StatusCode>=300 { b,_:=io.ReadAll(io.LimitReader(resp.Body,4096)); writeJSON(w,resp.StatusCode,map[string]string{"error":string(b)}); return }
	var result struct{AccessToken string `json:"access_token"`}; if err:=json.NewDecoder(resp.Body).Decode(&result);err!=nil||result.AccessToken=="" {writeJSON(w,502,map[string]string{"error":"Deepgram did not return a temporary token"});return}
	w.Header().Set("Content-Type","text/plain"); _,_=w.Write([]byte(result.AccessToken))
}

func replicateURL(output interface{}) string { switch v:=output.(type) { case string:return v; case []interface{}:if len(v)>0{return replicateURL(v[0])}; case map[string]interface{}:if u,ok:=v["url"].(string);ok{return u} }; return "" }

func openvoice(w http.ResponseWriter,r *http.Request) {
	c:=configSnapshot(); if c.ReplicateKey=="" {writeJSON(w,400,map[string]string{"error":"Replicate API token is not configured"});return}
	var in struct {Text string `json:"text"`; RefAudio string `json:"ref_audio"`; Language string `json:"language"`; Speed float64 `json:"speed"`}
	if err:=json.NewDecoder(io.LimitReader(r.Body,32<<20)).Decode(&in);err!=nil{writeJSON(w,400,map[string]string{"error":"Invalid request"});return}
	if strings.TrimSpace(in.Text)==""||in.RefAudio==""{writeJSON(w,400,map[string]string{"error":"Text and reference audio are required"});return}
	if !strings.HasPrefix(in.RefAudio,"data:audio/"){writeJSON(w,400,map[string]string{"error":"Reference audio must be an audio data URL"});return}
	if in.Language==""{in.Language="EN_NEWEST"};if in.Speed==0{in.Speed=1}
	payload:=map[string]interface{}{"version":replicateVersion,"input":map[string]interface{}{"text":in.Text,"audio":in.RefAudio,"speed":in.Speed,"language":in.Language}}
	body,_:=json.Marshal(payload); req,_:=http.NewRequest("POST","https://api.replicate.com/v1/predictions",bytes.NewReader(body));req.Header.Set("Authorization","Bearer "+c.ReplicateKey);req.Header.Set("Content-Type","application/json")
	resp,err:=http.DefaultClient.Do(req);if err!=nil{writeJSON(w,502,map[string]string{"error":err.Error()});return};defer resp.Body.Close();if resp.StatusCode<200||resp.StatusCode>=300{b,_:=io.ReadAll(io.LimitReader(resp.Body,8192));writeJSON(w,resp.StatusCode,map[string]string{"error":string(b)});return}
	var p prediction;if err:=json.NewDecoder(resp.Body).Decode(&p);err!=nil{writeJSON(w,502,map[string]string{"error":"Invalid Replicate response"});return};getURL:=p.URLs.Get;if getURL==""{getURL="https://api.replicate.com/v1/predictions/"+p.ID}
	for i:=0;i<180;i++{if i>0{time.Sleep(time.Second)};pr,err:=http.NewRequest("GET",getURL,nil);if err!=nil{break};pr.Header.Set("Authorization","Bearer "+c.ReplicateKey);got,err:=http.DefaultClient.Do(pr);if err!=nil{continue};var cur prediction;err=json.NewDecoder(got.Body).Decode(&cur);got.Body.Close();if err!=nil{continue};switch cur.Status{case "succeeded":u:=replicateURL(cur.Output);if u==""{writeJSON(w,502,map[string]string{"error":"OpenVoice returned no audio"});return};audioResp,err:=http.Get(u);if err!=nil{writeJSON(w,502,map[string]string{"error":err.Error()});return};defer audioResp.Body.Close();w.Header().Set("Content-Type","audio/wav");w.Header().Set("Cache-Control","no-store");_,_=io.Copy(w,audioResp.Body);return;case "failed","canceled":writeJSON(w,502,map[string]interface{}{"error":cur.Error});return}}
	writeJSON(w,504,map[string]string{"error":"OpenVoice timed out"})
}

func handler() http.Handler {
	mux:=http.NewServeMux()
	mux.HandleFunc("/api/config",func(w http.ResponseWriter,r *http.Request){if r.Method!=http.MethodPost{writeJSON(w,405,map[string]string{"error":"Method not allowed"});return};var c Config;if err:=json.NewDecoder(io.LimitReader(r.Body,4096)).Decode(&c);err!=nil{writeJSON(w,400,map[string]string{"error":"Invalid config"});return};cfg.Lock();cfg.DeepgramKey=strings.TrimSpace(c.DeepgramKey);cfg.ReplicateKey=strings.TrimSpace(c.ReplicateKey);cfg.Unlock();writeJSON(w,200,map[string]bool{"ok":true})})
	mux.HandleFunc("/api/deepgram-token",func(w http.ResponseWriter,r *http.Request){if r.Method==http.MethodGet{deepgramToken(w)}else{writeJSON(w,405,map[string]string{"error":"Method not allowed"})}})
	mux.HandleFunc("/api/openvoice",func(w http.ResponseWriter,r *http.Request){if r.Method==http.MethodPost{openvoice(w,r)}else{writeJSON(w,405,map[string]string{"error":"Method not allowed"})}})
	mux.HandleFunc("/",func(w http.ResponseWriter,r *http.Request){data,err:=webFS.ReadFile("web/index.html");if err!=nil{http.Error(w,"UI unavailable",500);return};w.Header().Set("Content-Type","text/html; charset=utf-8");w.Header().Set("Cache-Control","no-store");_,_=w.Write(data)})
	return mux
}

func chromePath() string {if runtime.GOOS!="windows"{return ""};candidates:=[]string{filepath.Join(os.Getenv("PROGRAMFILES"),"Google","Chrome","Application","chrome.exe"),filepath.Join(os.Getenv("PROGRAMFILES(X86)"),"Google","Chrome","Application","chrome.exe"),filepath.Join(os.Getenv("LOCALAPPDATA"),"Google","Chrome","Application","chrome.exe")};for _,p:=range candidates{if _,err:=os.Stat(p);err==nil{return p}};return ""}
func main(){ln,err:=net.Listen("tcp","127.0.0.1:0");if err!=nil{log.Fatal(err)};port:=ln.Addr().(*net.TCPAddr).Port;server:=&http.Server{Handler:handler()};url:=fmt.Sprintf("http://127.0.0.1:%d/",port);go func(){log.Fatal(server.Serve(ln))}();if chrome:=chromePath();chrome!=""{_=exec.Command(chrome,"--new-window",url).Start()}else if runtime.GOOS=="windows"{_=exec.Command("cmd","/c","start","",url).Start()};select{}}
