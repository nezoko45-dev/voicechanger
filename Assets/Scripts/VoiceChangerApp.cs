using System;
using System.Diagnostics;
using System.IO;
using UnityEngine;

public class VoiceChangerApp : MonoBehaviour
{
    public string engineFolder = "Seed-VC";
    public string python = "python";
    public string referenceWav = "";
    public int diffusionSteps = 6;
    public float blockTime = 0.18f;
    public float crossfade = 0.04f;
    public float cfgRate = 0.7f;
    public float extraLeft = 2.5f;
    public float extraRight = 0.02f;

    Process process;
    Vector2 scroll;
    string status = "Stopped";
    string errorText = "";

    string Root => Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
    string Engine => Path.Combine(Root, engineFolder);

    void Awake()
    {
        Application.runInBackground = true;
    }

    void Update()
    {
        if (process != null && process.HasExited)
        {
            process.Dispose();
            process = null;
            status = "Seed-VC stopped";
        }
    }

    void StartEngine()
    {
        errorText = "";

        if (process != null && !process.HasExited)
            return;

        string gui = Path.Combine(Engine, "real-time-gui.py");
        if (!File.Exists(gui))
        {
            status = "Seed-VC not installed";
            errorText = "Run setup_seedvc.bat in the repository root.";
            return;
        }

        if (string.IsNullOrWhiteSpace(referenceWav) || !File.Exists(referenceWav))
        {
            status = "Reference WAV required";
            return;
        }

        try
        {
            process = Process.Start(new ProcessStartInfo
            {
                FileName = python,
                Arguments = "real-time-gui.py --fp16 True",
                WorkingDirectory = Engine,
                UseShellExecute = true,
                CreateNoWindow = false
            });
            status = "Seed-VC started";
        }
        catch (Exception e)
        {
            status = "Start failed";
            errorText = e.Message;
        }
    }

    void WriteSeedConfig()
    {
        string dir = Path.Combine(Engine, "configs", "inuse");
        Directory.CreateDirectory(dir);

        string json =
            "{\"reference_audio_path\":\"" + EscapeJson(referenceWav) +
            "\",\"sr_type\":\"sr_model\",\"diffusion_steps\":" + diffusionSteps +
            ",\"inference_cfg_rate\":" + cfgRate.ToString(System.Globalization.CultureInfo.InvariantCulture) +
            ",\"max_prompt_length\":3.0,\"block_time\":" + blockTime.ToString(System.Globalization.CultureInfo.InvariantCulture) +
            ",\"crossfade_length\":" + crossfade.ToString(System.Globalization.CultureInfo.InvariantCulture) +
            ",\"extra_time_ce\":" + extraLeft.ToString(System.Globalization.CultureInfo.InvariantCulture) +
            ",\"extra_time\":" + extraLeft.ToString(System.Globalization.CultureInfo.InvariantCulture) +
            ",\"extra_time_right\":" + extraRight.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}";

        File.WriteAllText(Path.Combine(dir, "config.json"), json);
    }

    string EscapeJson(string value)
    {
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    void StopEngine()
    {
        if (process != null)
        {
            try { if (!process.HasExited) process.Kill(); } catch { }
            process.Dispose();
            process = null;
        }
        status = "Stopped";
    }

    void ChooseWav()
    {
#if UNITY_EDITOR
        string p = UnityEditor.EditorUtility.OpenFilePanel("Choose reference WAV", "", "wav");
        if (!string.IsNullOrEmpty(p))
            referenceWav = p;
#else
        status = "Use the Unity Editor to choose the reference WAV";
#endif
    }

    void OnDisable() => StopEngine();

    void OnGUI()
    {
        float w = Mathf.Min(820, Screen.width - 30);
        float h = Mathf.Min(680, Screen.height - 30);
        float x = (Screen.width - w) * .5f;
        float y = (Screen.height - h) * .5f;

        GUI.Box(new Rect(x, y, w, h), "LOCAL AI VOICE CHANGER");

        Rect view = new Rect(x + 15, y + 45, w - 30, h - 60);
        Rect area = new Rect(0, 0, w - 55, 760);
        scroll = GUI.BeginScrollView(view, scroll, area);

        float cy = 10;
        GUI.Label(new Rect(10, cy, area.width - 20, 28),
            "Seed-VC zero-shot realtime voice conversion");
        cy += 40;

        if (GUI.Button(new Rect(10, cy, 190, 32), "CHOOSE REFERENCE WAV"))
            ChooseWav();

        cy += 42;
        GUI.Label(new Rect(10, cy, area.width - 20, 55),
            string.IsNullOrEmpty(referenceWav) ? "No WAV selected" : referenceWav,
            GUI.skin.textArea);
        cy += 70;

        GUI.Label(new Rect(10, cy, 190, 25), "Diffusion steps: " + diffusionSteps);
        diffusionSteps = Mathf.RoundToInt(GUI.HorizontalSlider(
            new Rect(210, cy + 8, 300, 20), diffusionSteps, 1, 12));
        cy += 38;

        GUI.Label(new Rect(10, cy, 190, 25), "CFG rate: " + cfgRate.ToString("0.0"));
        cfgRate = GUI.HorizontalSlider(new Rect(210, cy + 8, 300, 20), cfgRate, 0, 1);
        cy += 38;

        GUI.Label(new Rect(10, cy, 190, 25), "Block: " + blockTime.ToString("0.00") + "s");
        blockTime = GUI.HorizontalSlider(new Rect(210, cy + 8, 300, 20), blockTime, .08f, .6f);
        cy += 38;

        GUI.Label(new Rect(10, cy, 190, 25), "Crossfade: " + crossfade.ToString("0.00") + "s");
        crossfade = GUI.HorizontalSlider(new Rect(210, cy + 8, 300, 20), crossfade, .02f, .2f);
        cy += 38;

        GUI.Label(new Rect(10, cy, 190, 25), "Left context: " + extraLeft.ToString("0.0") + "s");
        extraLeft = GUI.HorizontalSlider(new Rect(210, cy + 8, 300, 20), extraLeft, .5f, 5f);
        cy += 38;

        GUI.Label(new Rect(10, cy, 190, 25), "Right context: " + extraRight.ToString("0.00") + "s");
        extraRight = GUI.HorizontalSlider(new Rect(210, cy + 8, 300, 20), extraRight, .02f, .2f);
        cy += 50;

        GUI.Label(new Rect(10, cy, area.width - 20, 40), "Status: " + status);
        cy += 50;

        if (GUI.Button(new Rect(10, cy, 230, 50), "START VOICE ENGINE"))
            StartEngine();

        if (GUI.Button(new Rect(250, cy, 180, 50), "STOP"))
            StopEngine();

        cy += 65;
        if (!string.IsNullOrEmpty(errorText))
            GUI.Label(new Rect(10, cy, area.width - 20, 60), errorText, GUI.skin.textArea);

        cy += 75;
        GUI.Label(new Rect(10, cy, area.width - 20, 130),
            "Seed-VC owns the realtime neural audio stream. In its window choose your microphone and output. " +
            "For VRChat, route the converted output to VB-CABLE or Voicemeeter and choose that virtual microphone in VRChat. " +
            "Unity is the controller/launcher; the WAV is the voice reference.",
            GUI.skin.textArea);

        GUI.EndScrollView();
    }
}

#if UNITY_EDITOR
static class UnityEditorFileDialog
{
    public static string Open(string title)
    {
        string[] r = UnityEditor.EditorUtility.OpenFilePanel(title, "", "wav");
        return r;
    }
}
#endif
