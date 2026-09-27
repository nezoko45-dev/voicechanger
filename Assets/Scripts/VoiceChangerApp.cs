using System;
using System.Collections.Generic;
using UnityEngine;

public class VoiceChangerApp : MonoBehaviour
{
    [Range(-12f, 12f)] public float pitchSemitones = 0f;
    [Range(0f, 2f)] public float inputGain = 1f;
    public bool noiseGate = true;

    AudioClip micClip;
    AudioSource source;
    string selectedMic = "";
    bool running;
    int lastPosition;
    float[] ring = new float[96000];
    int writePos, readPos;
    Vector2 scroll;

    void Awake()
    {
        Application.runInBackground = true;
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

                if (noiseGate && Mathf.Abs(s) < 0.006f)
                    s = 0f;

                Push(s);
            }

            lastPosition = pos;
        }
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
        int available = writePos - readPos;
        if (available < 0) available += ring.Length;
        if (available < 2) return 0f;

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
            float sample = Pop() * 0.96f;

            for (int c = 0; c < channels; c++)
                data[i + c] = sample;
        }
    }

    void StartVoice()
    {
        if (Microphone.devices.Length == 0)
        {
            Debug.LogError("No microphone found.");
            return;
        }

        int index = Mathf.Clamp(GetSelectedMicIndex(), 0, Microphone.devices.Length - 1);
        selectedMic = Microphone.devices[index];

        micClip = Microphone.Start(selectedMic, true, 2, 48000);

        if (micClip == null)
        {
            Debug.LogError("Unity could not start the selected microphone.");
            return;
        }

        lastPosition = 0;
        writePos = 0;
        readPos = 0;

        source = GetComponent<AudioSource>();
        if (source == null)
            source = gameObject.AddComponent<AudioSource>();

        source.loop = true;
        source.playOnAwake = false;
        source.spatialBlend = 0f;

        // Keep an AudioSource attached to this GameObject so OnAudioFilterRead runs.
        source.clip = AudioClip.Create("RealtimeOutput", 48000, 1, 48000, false);
        source.Play();

        running = true;
        Debug.Log("VOICE CHANGER STARTED: " + selectedMic);
    }

    void StopVoice()
    {
        if (!running && micClip == null)
            return;

        if (!string.IsNullOrEmpty(selectedMic) && Microphone.IsRecording(selectedMic))
            Microphone.End(selectedMic);

        if (source != null)
            source.Stop();

        running = false;
        micClip = null;
        Debug.Log("VOICE CHANGER STOPPED");
    }

    void RefreshMics()
    {
        if (Microphone.devices.Length == 0)
        {
            selectedMic = "";
            return;
        }

        if (string.IsNullOrEmpty(selectedMic))
            selectedMic = Microphone.devices[0];
    }

    int GetSelectedMicIndex()
    {
        for (int i = 0; i < Microphone.devices.Length; i++)
        {
            if (Microphone.devices[i] == selectedMic)
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

        GUIStyle statusStyle = new GUIStyle(GUI.skin.label);
        statusStyle.fontSize = 18;
        statusStyle.alignment = TextAnchor.MiddleCenter;
        statusStyle.normal.textColor = running ? Color.green : Color.white;

        GUI.Label(
            new Rect(x + 20, y + 110, width - 40, 35),
            running ? "LISTENING — LOCAL C# AUDIO" : "STOPPED",
            statusStyle
        );

        GUI.Label(new Rect(x + 65, y + 165, 130, 30), "Microphone");

        string[] microphones = Microphone.devices.Length > 0
            ? Microphone.devices
            : new[] { "No microphone detected" };

        int micIndex = GetSelectedMicIndex();

        GUI.enabled = !running;

        int newMicIndex = GUI.SelectionGrid(
            new Rect(x + 200, y + 155, 440, 45),
            micIndex,
            microphones,
            1
        );

        if (newMicIndex != micIndex && newMicIndex >= 0 && newMicIndex < microphones.Length)
            selectedMic = microphones[newMicIndex];

        GUI.enabled = true;

        GUI.Label(
            new Rect(x + 40, y + 225, width - 80, 30),
            "Pitch: " + pitchSemitones.ToString("+0.0;-0.0;0.0") + " semitones",
            center
        );

        pitchSemitones = GUI.HorizontalSlider(
            new Rect(x + 120, y + 260, width - 240, 25),
            pitchSemitones,
            -12f,
            12f
        );

        GUI.Label(
            new Rect(x + 30, y + 305, width - 60, 30),
            "Output: Windows default audio device / Voicemeeter",
            center
        );

        GUI.Label(
            new Rect(x + 30, y + 340, width - 60, 30),
            "Start the realtime microphone audio with the button below.",
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
            "Local C# audio path — no UI package required",
            center
        );
    }
}