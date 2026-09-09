using System;
using System.IO;
using System.Reflection;
using System.Text;
using HarmonyLib;

namespace VoiceChangerMod;

[HarmonyPatch(typeof(NativeGui), "CreateChild")]
internal static class ElevenLabsGuiControlsPatch
{
    private const int FinalInstructionId = 1013;
    private const int ApiEditId = 1101;
    private const int VoiceEditId = 1102;
    private const int WM_GETTEXT = 0x000D;
    private const int WM_COMMAND = 0x0111;
    private const int BN_CLICKED = 0;
    private const int ES_PASSWORD = 0x20;
    private const int ES_AUTOHSCROLL = 0x80;
    private const int WS_CHILD = 0x40000000;
    private const int WS_VISIBLE = 0x10000000;
    private const int WS_TABSTOP = 0x00010000;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOZORDER = 0x0004;
    private const uint SWP_SHOWWINDOW = 0x0040;

    private static IntPtr _apiEdit;
    private static IntPtr _voiceEdit;
    private static bool _created;
    private static readonly string ConfigPath = Path.Combine("UserData", "VoiceChangerMod.cfg");

    private static void Postfix(string type, string text, int x, int y, int w, int h, int style, int id)
    {
        if (_created || id != FinalInstructionId) return;
        try
        {
            IntPtr window = GetGuiWindow();
            if (window == IntPtr.Zero) return;

            SetWindowPos(window, IntPtr.Zero, 0, 0, 620, 520, SWP_NOMOVE | SWP_NOZORDER | SWP_SHOWWINDOW);
            CreateLabel(window, "ElevenLabs API key", 20, 355, 280, 20, 1201);
            CreateLabel(window, "ElevenLabs target Voice ID", 310, 355, 280, 20, 1202);
            _apiEdit = CreateEdit(window, 20, 380, 280, 28, ES_PASSWORD | ES_AUTOHSCROLL, ApiEditId, ReadSetting("ElevenLabsApiKey"));
            _voiceEdit = CreateEdit(window, 310, 380, 280, 28, ES_AUTOHSCROLL, VoiceEditId, ReadSetting("ElevenLabsVoiceId"));
            CreateLabel(window, "Speech-to-speech preserves your timing and delivery instead of re-speaking the transcript.", 20, 420, 570, 35, 1203);
            _created = true;
        }
        catch (Exception ex)
        {
            MelonLoader.MelonLogger.Error("ElevenLabs F8 controls failed: " + ex.Message);
        }
    }

    [HarmonyPatch(typeof(NativeGui), "WndProc")]
    internal static class SaveCredentialsPatch
    {
        [HarmonyPrefix]
        private static void Prefix(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
        {
            if (msg != WM_COMMAND) return;

            int id = unchecked((short)((long)wParam & 0xFFFF));
            int code = unchecked((short)(((long)wParam >> 16) & 0xFFFF));
            if (code != BN_CLICKED || (id != 1004 && id != 1005)) return;
            if (_apiEdit == IntPtr.Zero || _voiceEdit == IntPtr.Zero) return;

            try
            {
                SaveSetting("ElevenLabsApiKey", ReadEdit(_apiEdit));
                SaveSetting("ElevenLabsVoiceId", ReadEdit(_voiceEdit));
                MelonLoader.MelonLogger.Msg("ElevenLabs Voice Changer settings saved.");
            }
            catch (Exception ex)
            {
                MelonLoader.MelonLogger.Error("ElevenLabs settings save failed: " + ex.Message);
            }
        }
    }

    private static IntPtr GetGuiWindow()
    {
        FieldInfo field = typeof(NativeGui).GetField("_window", BindingFlags.NonPublic | BindingFlags.Static);
        return field != null ? (IntPtr)(field.GetValue(null) ?? IntPtr.Zero) : IntPtr.Zero;
    }

    private static IntPtr CreateEdit(IntPtr parent, int x, int y, int w, int h, int extraStyle, int id, string value)
    {
        return NativeMethods.CreateWindowEx(0, "EDIT", value ?? "", WS_CHILD | WS_VISIBLE | WS_TABSTOP | extraStyle, x, y, w, h, parent, (IntPtr)id, NativeMethods.GetModuleHandle(null), IntPtr.Zero);
    }

    private static void CreateLabel(IntPtr parent, string text, int x, int y, int w, int h, int id)
    {
        NativeMethods.CreateWindowEx(0, "STATIC", text, WS_CHILD | WS_VISIBLE, x, y, w, h, parent, (IntPtr)id, NativeMethods.GetModuleHandle(null), IntPtr.Zero);
    }

    private static string ReadEdit(IntPtr handle)
    {
        var sb = new StringBuilder(8192);
        NativeMethods.SendMessage(handle, WM_GETTEXT, (IntPtr)sb.Capacity, sb);
        return sb.ToString().Trim();
    }

    private static string ReadSetting(string key)
    {
        try
        {
            string envName = key == "ElevenLabsApiKey" ? "ELEVENLABS_API_KEY" : "ELEVENLABS_VOICE_ID";
            string? env = Environment.GetEnvironmentVariable(envName)?.Trim();
            if (!string.IsNullOrWhiteSpace(env)) return env;
            if (!File.Exists(ConfigPath)) return "";

            string prefix = key + "=";
            foreach (string line in File.ReadAllLines(ConfigPath))
                if (line.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    return line.Substring(prefix.Length).Trim();
        }
        catch { }

        return "";
    }

    private static void SaveSetting(string key, string value)
    {
        Directory.CreateDirectory("UserData");
        string[] lines = File.Exists(ConfigPath) ? File.ReadAllLines(ConfigPath) : Array.Empty<string>();
        string prefix = key + "=";
        bool replaced = false;

        for (int i = 0; i < lines.Length; i++)
        {
            if (!lines[i].StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
            lines[i] = prefix + (value ?? "").Replace("\r", "").Replace("\n", "");
            replaced = true;
            break;
        }

        if (!replaced)
        {
            var list = new System.Collections.Generic.List<string>(lines);
            list.Add(prefix + (value ?? "").Replace("\r", "").Replace("\n", ""));
            lines = list.ToArray();
        }

        File.WriteAllLines(ConfigPath, lines);
    }

    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
