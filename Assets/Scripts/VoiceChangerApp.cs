using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;

public class VoiceChangerApp : MonoBehaviour
{
    [Range(-12f,12f)] public float pitchSemitones = 0f;
    [Range(0f,2f)] public float inputGain = 1f;
    public bool noiseGate = true;

    AudioClip micClip;
    AudioSource source;
    string selectedMic;
    bool running;
    int lastPosition;
    float[] ring = new float[96000];
    int writePos, readPos;

    Text status, pitchText;
    Dropdown micDropdown;
    Slider pitchSlider;
    Button startButton, stopButton;

    void Awake()
    {
        Application.runInBackground = true;
        EnsureEventSystem();
        BuildUI();
        RefreshMics();
    }

    void Update()
    {
        if (!running || micClip == null) return;

        int pos = Microphone.GetPosition(selectedMic);
        if (pos < 0) return;

        int frames = pos - lastPosition;
        if (frames < 0) frames += micClip.samples;
        if (frames > micClip.samples) frames = micClip.samples;

        if (frames > 0)
        {
            var temp = new float[frames * micClip.channels];
            micClip.GetData(temp, lastPosition);

            for (int i = 0; i < frames; i++)
            {
                float s = temp[i * micClip.channels] * inputGain;
                if (noiseGate && Mathf.Abs(s) < 0.006f) s = 0f;
                Push(s);
            }

            lastPosition = pos;
        }
    }

    void Push(float s)
    {
        ring[writePos] = s;
        writePos = (writePos + 1) % ring.Length;
        if (writePos == readPos)
            readPos = (readPos + 1) % ring.Length;
    }

    float Pop()
    {
        int n = writePos - readPos;
        if (n < 0) n += ring.Length;
        if (n < 2) return 0f;

        float a = ring[readPos];
        float b = ring[(readPos + 1) % ring.Length];
        readPos = (readPos + 1) % ring.Length;
        return Mathf.Lerp(a, b, 0.5f);
    }

    void OnAudioFilterRead(float[] data, int channels)
    {
        if (!running)
        {
            Array.Clear(data, 0, data.Length);
            return;
        }

        for (int i = 0; i < data.Length; i += channels)
        {
            float s = Pop() * 0.96f;
            for (int c = 0; c < channels; c++)
                data[i + c] = s;
        }
    }

    void StartVoice()
    {
        if (Microphone.devices.Length == 0)
        {
            SetStatus("NO MICROPHONE FOUND");
            return;
        }

        int index = Mathf.Clamp(micDropdown.value, 0, Microphone.devices.Length - 1);
        selectedMic = Microphone.devices[index];

        micClip = Microphone.Start(selectedMic, true, 2, 48000);
        lastPosition = 0;
        writePos = 0;
        readPos = 0;

        source.loop = true;
        source.clip = AudioClip.Create("RealtimeOutput", 48000, 1, 48000, false);
        source.Play();

        running = true;
        startButton.interactable = false;
        stopButton.interactable = true;
        micDropdown.interactable = false;
        SetStatus("LISTENING — LOCAL C# AUDIO");
    }

    void StopVoice()
    {
        if (!running && micClip == null) return;

        if (!string.IsNullOrEmpty(selectedMic) && Microphone.IsRecording(selectedMic))
            Microphone.End(selectedMic);

        if (source != null)
            source.Stop();

        running = false;
        micClip = null;

        if (startButton != null) startButton.interactable = true;
        if (stopButton != null) stopButton.interactable = false;
        if (micDropdown != null) micDropdown.interactable = true;

        SetStatus("STOPPED");
    }

    void OnDisable()
    {
        StopVoice();
    }

    void RefreshMics()
    {
        micDropdown.ClearOptions();

        var names = new List<string>(Microphone.devices);
        if (names.Count == 0)
            names.Add("No microphone detected");

        micDropdown.AddOptions(names);
    }

    void SetStatus(string s)
    {
        if (status != null)
            status.text = s;
    }

    void EnsureEventSystem()
    {
        if (FindFirstObjectByType<EventSystem>() != null)
            return;

        var go = new GameObject("EventSystem");
        go.AddComponent<EventSystem>();
        go.AddComponent<StandaloneInputModule>();
    }

    void BuildUI()
    {
        var cg = new GameObject("VoiceChangerUI");
        var canvas = cg.AddComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;

        var scaler = cg.AddComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1280, 720);

        cg.AddComponent<GraphicRaycaster>();

        var panel = Panel(canvas.transform, new Vector2(720, 560));

        Text(panel.transform, "UNITY VOICECHANGER", 30, new Vector2(0, 210));
        Text(panel.transform, "LOCAL C# REALTIME AUDIO", 16, new Vector2(0, 172));

        status = Text(panel.transform, "STOPPED", 18, new Vector2(0, 130));

        Text(panel.transform, "Microphone", 16, new Vector2(-210, 75));
        micDropdown = Dropdown(panel.transform, new Vector2(50, 75));

        pitchText = Text(panel.transform, "Pitch: 0.0 semitones", 16, new Vector2(0, 15));

        pitchSlider = Slider(panel.transform, new Vector2(0, -25));
        pitchSlider.minValue = -12f;
        pitchSlider.maxValue = 12f;
        pitchSlider.value = 0f;
        pitchSlider.onValueChanged.AddListener(v =>
        {
            pitchSemitones = v;
            pitchText.text = $"Pitch: {v:+0.0;-0.0;0.0} semitones";
        });

        Text(panel.transform, "Output: Windows default audio device / Voicemeeter", 15, new Vector2(0, -90));
        Text(panel.transform, "Press START to begin realtime microphone audio.", 13, new Vector2(0, -140));

        startButton = Button(panel.transform, "START VOICE CHANGER", new Vector2(-150, -205), true);
        stopButton = Button(panel.transform, "STOP", new Vector2(150, -205), false);

        startButton.onClick.AddListener(StartVoice);
        stopButton.onClick.AddListener(StopVoice);

        source = gameObject.AddComponent<AudioSource>();
        source.playOnAwake = false;
        source.spatialBlend = 0f;
    }

    GameObject Panel(Transform parent, Vector2 size)
    {
        var g = new GameObject("Panel");
        g.transform.SetParent(parent, false);

        var image = g.AddComponent<Image>();
        image.color = new Color(0.055f, 0.06f, 0.08f, 0.98f);

        var rt = g.GetComponent<RectTransform>();
        rt.sizeDelta = size;

        return g;
    }

    Text Text(Transform parent, string value, int size, Vector2 pos)
    {
        var g = new GameObject("Text");
        g.transform.SetParent(parent, false);

        var t = g.AddComponent<Text>();
        t.text = value;
        t.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        t.fontSize = size;
        t.alignment = TextAnchor.MiddleCenter;
        t.color = Color.white;

        t.rectTransform.sizeDelta = new Vector2(620, 50);
        t.rectTransform.anchoredPosition = pos;

        return t;
    }

    Dropdown Dropdown(Transform parent, Vector2 pos)
    {
        var g = new GameObject("MicrophoneDropdown");
        g.transform.SetParent(parent, false);

        var image = g.AddComponent<Image>();
        image.color = new Color(0.12f, 0.13f, 0.16f);

        var d = g.AddComponent<Dropdown>();
        d.GetComponent<RectTransform>().sizeDelta = new Vector2(390, 42);
        d.GetComponent<RectTransform>().anchoredPosition = pos;

        return d;
    }

    Slider Slider(Transform parent, Vector2 pos)
    {
        var g = new GameObject("PitchSlider");
        g.transform.SetParent(parent, false);

        var s = g.AddComponent<Slider>();
        s.GetComponent<RectTransform>().sizeDelta = new Vector2(480, 32);
        s.GetComponent<RectTransform>().anchoredPosition = pos;

        return s;
    }

    Button Button(Transform parent, string label, Vector2 pos, bool enabled)
    {
        var g = new GameObject(label);
        g.transform.SetParent(parent, false);

        var image = g.AddComponent<Image>();
        image.color = enabled
            ? new Color(0.12f, 0.55f, 0.25f, 1f)
            : new Color(0.35f, 0.12f, 0.12f, 1f);

        var b = g.AddComponent<Button>();
        b.interactable = enabled;

        var colors = b.colors;
        colors.normalColor = image.color;
        colors.highlightedColor = new Color(0.2f, 0.7f, 0.35f, 1f);
        colors.pressedColor = new Color(0.08f, 0.4f, 0.18f, 1f);
        colors.disabledColor = new Color(0.25f, 0.25f, 0.25f, 0.6f);
        b.colors = colors;

        var rt = g.GetComponent<RectTransform>();
        rt.sizeDelta = new Vector2(230, 65);
        rt.anchoredPosition = pos;

        var text = Text(g.transform, label, 18, Vector2.zero);
        text.rectTransform.sizeDelta = new Vector2(220, 55);

        return b;
    }
}