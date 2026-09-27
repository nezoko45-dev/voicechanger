using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;

public class VoiceChangerApp : MonoBehaviour
{
    [Range(0f, 2f)] public float inputGain = 1f;
    public bool noiseGate = true;

    Type microphoneType;
    Type audioClipType;
    object micClip;
    Component audioSource;
    string selectedMic = "";
    bool running;
    int lastPosition;

    readonly float[] ring = new float[96000];
    int writePos;
    int readPos;

    void Awake()
    {
        Application.runInBackground = true;
        FindAudioTypes();
        RefreshMics();
    }

    void FindAudioTypes()
    {
        microphoneType = FindType("UnityEngine.Microphone");
        audioClipType = FindType("UnityEngine.AudioClip");
    }

    Type FindType(string fullName)
    {
        foreach (Assembly assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            Type type = assembly.GetType(fullName, false);
            if (type != null)
                return type;
        }
        return null;
    }

    object CallStatic(Type type, string method, params object[] args)
    {
        if (type == null) return null;

        MethodInfo info = type.GetMethod(
            method,
            BindingFlags.Public | BindingFlags.Static
        );

        return info == null ? null : info.Invoke(null, args);
    }

    string[] GetMicrophones()
    {
        object result = CallStatic(microphoneType, "get_devices");
        return result as string[] ?? Array.Empty<string>();
    }

    int GetMicPosition()
    {
        object result = CallStatic(
            microphoneType,
            "GetPosition",
            selectedMic
        );

        return result is int value ? value : -1;
    }

    bool IsMicRecording()
    {
        object result = CallStatic(
            microphoneType,
            "IsRecording",
            selectedMic
        );

        return result is bool value && value;
    }

    void Update()
    {
        if (!running || micClip == null)
            return;

        int pos = GetMicPosition();
        if (pos < 0)
            return;

        int samples = GetIntProperty(micClip, "samples");
        int channels = GetIntProperty(micClip, "channels");

        if (samples <= 0 || channels <= 0)
            return;

        int frames = pos - lastPosition;
        if (frames < 0)
            frames += samples;

        if (frames > samples)
            frames = samples;

        if (frames <= 0)
            return;

        float[] temp = new float[frames * channels];

        MethodInfo getData = micClip.GetType().GetMethod(
            "GetData",
            new[] { typeof(float[]), typeof(int) }
        );

        if (getData == null)
            return;

        getData.Invoke(micClip, new object[] { temp, lastPosition });

        for (int i = 0; i < frames; i++)
        {
            float sample = temp[i * channels] * inputGain;

            if (noiseGate && Mathf.Abs(sample) < 0.006f)
                sample = 0f;

            Push(sample);
        }

        lastPosition = pos;
    }

    int GetIntProperty(object target, string property)
    {
        PropertyInfo info = target.GetType().GetProperty(property);
        if (info == null)
            return 0;

        object value = info.GetValue(target);
        return value is int i ? i : 0;
    }

    void Push(float sample)
    {
        ring[writePos] = sample;
        writePos = (writePos + 1) % ring.Length;

        if (writePos == readPos)
            readPos = (readPos + 1) % ring.Length;
    }

    float Pop()
    {
        if (writePos == readPos)
            return 0f;

        float sample = ring[readPos];
        readPos = (readPos + 1) % ring.Length;
        return sample;
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
            float sample = Pop();

            for (int c = 0; c < channels; c++)
                data[i + c] = sample;
        }
    }

    void StartVoice()
    {
        string[] microphones = GetMicrophones();

        if (microphones.Length == 0)
        {
            Debug.LogError("No microphone found.");
            return;
        }

        int index = Mathf.Clamp(GetSelectedMicIndex(), 0, microphones.Length - 1);
        selectedMic = microphones[index];

        micClip = CallStatic(
            microphoneType,
            "Start",
            selectedMic,
            true,
            2,
            48000
        );

        if (micClip == null)
        {
            Debug.LogError("Unity could not start the selected microphone.");
            return;
        }

        lastPosition = 0;
        writePos = 0;
        readPos = 0;

        audioSource = GetComponent("AudioSource");

        if (audioSource == null)
            audioSource = gameObject.AddComponent("AudioSource");

        SetProperty(audioSource, "loop", true);
        SetProperty(audioSource, "playOnAwake", false);
        SetProperty(audioSource, "spatialBlend", 0f);

        MethodInfo create = audioClipType?.GetMethod(
            "Create",
            BindingFlags.Public | BindingFlags.Static,
            null,
            new[]
            {
                typeof(string),
                typeof(int),
                typeof(int),
                typeof(int),
                typeof(bool)
            },
            null
        );

        if (create != null)
        {
            object outputClip = create.Invoke(
                null,
                new object[] { "RealtimeOutput", 48000, 1, 48000, false }
            );

            SetProperty(audioSource, "clip", outputClip);
        }

        InvokeMethod(audioSource, "Play");

        running = true;
        Debug.Log("VOICE CHANGER STARTED: " + selectedMic);
    }

    void StopVoice()
    {
        if (!running && micClip == null)
            return;

        if (!string.IsNullOrEmpty(selectedMic) && IsMicRecording())
            CallStatic(microphoneType, "End", selectedMic);

        if (audioSource != null)
            InvokeMethod(audioSource, "Stop");

        running = false;
        micClip = null;

        Debug.Log("VOICE CHANGER STOPPED");
    }

    void SetProperty(object target, string name, object value)
    {
        if (target == null)
            return;

        PropertyInfo property = target.GetType().GetProperty(name);
        if (property != null && property.CanWrite)
            property.SetValue(target, value);
    }

    void InvokeMethod(object target, string name)
    {
        if (target == null)
            return;

        MethodInfo method = target.GetType().GetMethod(
            name,
            BindingFlags.Public | BindingFlags.Instance
        );

        method?.Invoke(target, null);
    }

    void RefreshMics()
    {
        string[] microphones = GetMicrophones();

        if (microphones.Length == 0)
        {
            selectedMic = "";
            return;
        }

        if (string.IsNullOrEmpty(selectedMic))
            selectedMic = microphones[0];
    }

    int GetSelectedMicIndex()
    {
        string[] microphones = GetMicrophones();

        for (int i = 0; i < microphones.Length; i++)
        {
            if (microphones[i] == selectedMic)
                return i;
        }

        return 0;
    }

    void OnDisable()
    {
        StopVoice();
    }

    void OnGUI()
    {
        GUI.depth = 0;

        float width = 720f;
        float height = 560f;
        float x = (Screen.width - width) * 0.5f;
        float y = (Screen.height - height) * 0.5f;

        GUI.Box(new Rect(x, y, width, height), "");

        GUIStyle title = new GUIStyle(GUI.skin.label);
        title.fontSize = 30;
        title.alignment = TextAnchor.MiddleCenter;
        title.fontStyle = FontStyle.Bold;

        GUIStyle center = new GUIStyle(GUI.skin.label);
        center.fontSize = 16;
        center.alignment = TextAnchor.MiddleCenter;

        GUI.Label(new Rect(x + 20, y + 25, width - 40, 45), "UNITY VOICECHANGER", title);
        GUI.Label(new Rect(x + 20, y + 70, width - 40, 30), "LOCAL C# REALTIME AUDIO", center);

        GUIStyle status = new GUIStyle(GUI.skin.label);
        status.fontSize = 18;
        status.alignment = TextAnchor.MiddleCenter;
        status.normal.textColor = running ? Color.green : Color.white;

        GUI.Label(
            new Rect(x + 20, y + 110, width - 40, 35),
            running ? "LISTENING — LOCAL C# AUDIO" : "STOPPED",
            status
        );

        GUI.Label(new Rect(x + 65, y + 165, 130, 30), "Microphone");

        string[] microphones = GetMicrophones();
        if (microphones.Length == 0)
            microphones = new[] { "No microphone detected" };

        int micIndex = GetSelectedMicIndex();

        GUI.enabled = !running;

        int newMicIndex = GUI.SelectionGrid(
            new Rect(x + 200, y + 155, 440, 45),
            micIndex,
            microphones,
            1
        );

        if (newMicIndex >= 0 && newMicIndex < microphones.Length)
            selectedMic = microphones[newMicIndex];

        GUI.enabled = true;

        GUI.Label(
            new Rect(x + 40, y + 225, width - 80, 30),
            "Input gain: " + inputGain.ToString("0.00"),
            center
        );

        inputGain = GUI.HorizontalSlider(
            new Rect(x + 120, y + 260, width - 240, 25),
            inputGain,
            0f,
            2f
        );

        GUI.Label(
            new Rect(x + 30, y + 305, width - 60, 30),
            "Output: Windows default audio device / Voicemeeter",
            center
        );

        GUI.Label(
            new Rect(x + 30, y + 340, width - 60, 30),
            "Local microphone → realtime audio",
            center
        );

        GUI.enabled = !running;

        if (GUI.Button(new Rect(x + 80, y + 400, 270, 70), "START VOICE CHANGER"))
            StartVoice();

        GUI.enabled = running;

        if (GUI.Button(new Rect(x + 370, y + 400, 270, 70), "STOP"))
            StopVoice();

        GUI.enabled = true;

        GUI.Label(
            new Rect(x + 30, y + 485, width - 60, 30),
            "No compile-time AudioSource / AudioClip dependency",
            center
        );
    }
}
