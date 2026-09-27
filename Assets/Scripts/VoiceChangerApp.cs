using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class VoiceChangerApp : MonoBehaviour
{
    [Range(-12f,12f)] public float pitchSemitones = 0f;
    [Range(0f,2f)] public float inputGain = 1f;
    public bool noiseGate = true;
    AudioClip micClip; AudioSource source; string selectedMic; bool running; int lastPosition;
    float[] ring = new float[96000]; int writePos; int readPos;
    Text status, pitchText; Dropdown micDropdown; Slider pitchSlider; Button startButton, stopButton;

    void Awake(){Application.runInBackground=true; BuildUI(); RefreshMics();}
    void Update(){
        if(!running||micClip==null)return; int pos=Microphone.GetPosition(selectedMic); if(pos<0)return;
        int frames=pos-lastPosition; if(frames<0)frames+=micClip.samples; if(frames>micClip.samples)frames=micClip.samples;
        if(frames>0){var temp=new float[frames*micClip.channels]; micClip.GetData(temp,lastPosition); for(int i=0;i<frames;i++){float s=temp[i*micClip.channels]*inputGain;if(noiseGate&&Mathf.Abs(s)<.006f)s=0;Push(s);} lastPosition=pos;}
    }
    void Push(float s){ring[writePos]=s;writePos=(writePos+1)%ring.Length;if(writePos==readPos)readPos=(readPos+1)%ring.Length;}
    float Pop(){int n=writePos-readPos;if(n<0)n+=ring.Length;if(n<2)return 0;float a=ring[readPos],b=ring[(readPos+1)%ring.Length];readPos=(readPos+1)%ring.Length;return Mathf.Lerp(a,b,.5f);}
    void OnAudioFilterRead(float[] data,int channels){if(!running){Array.Clear(data,0,data.Length);return;}for(int i=0;i<data.Length;i+=channels){float s=Pop()*.96f;for(int c=0;c<channels;c++)data[i+c]=s;}}
    void StartVoice(){
        if(Microphone.devices.Length==0){SetStatus("No microphone found");return;}
        selectedMic=Microphone.devices[Mathf.Clamp(micDropdown.value,0,Microphone.devices.Length-1)]; micClip=Microphone.Start(selectedMic,true,2,48000);lastPosition=0;writePos=readPos=0;
        source.loop=true;source.clip=AudioClip.Create("RealtimeOutput",48000,1,48000,false);source.Play();running=true;startButton.interactable=false;stopButton.interactable=true;SetStatus("LISTENING — local C# audio");
    }
    void StopVoice(){if(!running&&micClip==null)return;if(!string.IsNullOrEmpty(selectedMic)&&Microphone.IsRecording(selectedMic))Microphone.End(selectedMic);if(source!=null)source.Stop();running=false;micClip=null;if(startButton!=null)startButton.interactable=true;if(stopButton!=null)stopButton.interactable=false;if(status!=null)SetStatus("STOPPED");}
    void OnDisable(){StopVoice();}
    void RefreshMics(){micDropdown.ClearOptions();var names=new List<string>(Microphone.devices);if(names.Count==0)names.Add("No microphone detected");micDropdown.AddOptions(names);}
    void SetStatus(string s){if(status!=null)status.text=s;}
    void BuildUI(){
        var cg=new GameObject("VoiceChangerUI");var canvas=cg.AddComponent<Canvas>();canvas.renderMode=RenderMode.ScreenSpaceOverlay;cg.AddComponent<CanvasScaler>().uiScaleMode=CanvasScaler.ScaleMode.ScaleWithScreenSize;cg.AddComponent<GraphicRaycaster>();
        var panel=Panel(canvas.transform,new Vector2(720,560));Text(panel.transform,"UNITY VOICECHANGER",30,new Vector2(0,210));Text(panel.transform,"LOCAL C# REALTIME AUDIO",16,new Vector2(0,172));status=Text(panel.transform,"STOPPED",16,new Vector2(0,130));Text(panel.transform,"Microphone",16,new Vector2(-210,75));micDropdown=Dropdown(panel.transform,new Vector2(50,75));pitchText=Text(panel.transform,"Pitch: 0.0 semitones",16,new Vector2(0,15));pitchSlider=Slider(panel.transform,new Vector2(0,-25));pitchSlider.minValue=-12;pitchSlider.maxValue=12;pitchSlider.value=0;pitchSlider.onValueChanged.AddListener(v=>{pitchSemitones=v;pitchText.text=$"Pitch: {v:+0.0;-0.0;0.0} semitones";});Text(panel.transform,"Output: Windows default audio device / Voicemeeter",15,new Vector2(0,-90));Text(panel.transform,"Reference WAV is reserved for the neural conversion engine stage.",13,new Vector2(0,-140));startButton=Button(panel.transform,"START",new Vector2(-110,-205));stopButton=Button(panel.transform,"STOP",new Vector2(110,-205));startButton.onClick.AddListener(StartVoice);stopButton.onClick.AddListener(StopVoice);stopButton.interactable=false;source=gameObject.AddComponent<AudioSource>();source.playOnAwake=false;source.spatialBlend=0;
    }
    GameObject Panel(Transform p,Vector2 size){var g=new GameObject("Panel");g.transform.SetParent(p,false);g.AddComponent<Image>().color=new Color(.055f,.06f,.08f,.98f);g.GetComponent<RectTransform>().sizeDelta=size;return g;}
    Text Text(Transform p,string v,int size,Vector2 pos){var g=new GameObject("Text");g.transform.SetParent(p,false);var t=g.AddComponent<Text>();t.text=v;t.font=Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");t.fontSize=size;t.alignment=TextAnchor.MiddleCenter;t.color=Color.white;t.rectTransform.sizeDelta=new Vector2(620,50);t.rectTransform.anchoredPosition=pos;return t;}
    Dropdown Dropdown(Transform p,Vector2 pos){var g=new GameObject("MicrophoneDropdown");g.transform.SetParent(p,false);var d=g.AddComponent<Dropdown>();d.GetComponent<RectTransform>().sizeDelta=new Vector2(390,42);d.GetComponent<RectTransform>().anchoredPosition=pos;return d;}
    Slider Slider(Transform p,Vector2 pos){var g=new GameObject("PitchSlider");g.transform.SetParent(p,false);var s=g.AddComponent<Slider>();s.GetComponent<RectTransform>().sizeDelta=new Vector2(480,32);s.GetComponent<RectTransform>().anchoredPosition=pos;return s;}
    Button Button(Transform p,string label,Vector2 pos){var g=new GameObject(label);g.transform.SetParent(p,false);g.AddComponent<Image>().color=new Color(.18f,.2f,.26f);var b=g.AddComponent<Button>();g.GetComponent<RectTransform>().sizeDelta=new Vector2(180,58);g.GetComponent<RectTransform>().anchoredPosition=pos;Text(g.transform,label,18,Vector2.zero);return b;}
}
