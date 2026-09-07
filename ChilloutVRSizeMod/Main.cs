using System;
using System.Reflection;
using System.Runtime.InteropServices;
using MelonLoader;

[assembly: MelonInfo(typeof(ChilloutVRSizeMod.Main), "ChilloutVR Size Mod", "1.0.4", "nezoko45-dev")]

namespace ChilloutVRSizeMod;

public sealed class Main : MelonMod
{
    private const float MinScale = 0.1f;
    private const float MaxScale = 5.0f;
    private static float _scale = 1.0f;
    private static bool _f10Down;
    private static bool _windowCreated;
    private static IntPtr _window;
    private static IntPtr _slider;
    private static IntPtr _label;
    private static WndProcDelegate? _wndProc;
    private static Type? _localPlayerType;

    private const int WS_CAPTION = 0x00C00000;
    private const int WS_SYSMENU = 0x00080000;
    private const int WS_MINIMIZEBOX = 0x00020000;
    private const int WS_VISIBLE = 0x10000000;
    private const int WS_CHILD = 0x40000000;
    private const int WS_EX_TOPMOST = 0x00000008;
    private const int WM_DESTROY = 0x0002;
    private const int WM_HSCROLL = 0x0114;
    private const int WM_CLOSE = 0x0010;
    private const int TBM_SETRANGE = 0x0406;
    private const int TBM_SETPOS = 0x0405;
    private const int TBM_GETPOS = 0x0400;
    private const int TBS_AUTOTICKS = 0x0001;
    private const int CW_USEDEFAULT = unchecked((int)0x80000000);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(int exStyle, string className, string windowName, int style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern ushort RegisterClass(ref WNDCLASS wc);
    [DllImport("user32.dll")] private static extern IntPtr DefWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr LoadCursor(IntPtr instance, int cursor);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] private static extern bool UpdateWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool SetWindowText(IntPtr hWnd, string text);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr GetModuleHandle(string? name);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASS
    {
        public uint style;
        public WndProcDelegate lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string lpszMenuName;
        public string lpszClassName;
    }

    private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    public override void OnApplicationStart()
    {
        MelonLogger.Msg("ChilloutVR Size Mod 1.0.4 loaded.");
        MelonLogger.Msg("F10 opens the size slider. F7/F8 change size. F9 resets.");
    }

    public override void OnUpdate()
    {
        bool f10 = (GetAsyncKeyState(0x79) & 0x8000) != 0;
        if (f10 && !_f10Down)
        {
            if (_windowCreated) CloseWindow();
            else CreateSliderWindow();
        }
        _f10Down = f10;

        if ((GetAsyncKeyState(0x76) & 0x0001) != 0) SetScale(_scale - 0.1f);
        if ((GetAsyncKeyState(0x77) & 0x0001) != 0) SetScale(_scale + 0.1f);
        if ((GetAsyncKeyState(0x78) & 0x0001) != 0) SetScale(1.0f);
        ApplyScale();
    }

    private static void CreateSliderWindow()
    {
        _wndProc = WindowProc;
        IntPtr instance = GetModuleHandle(null);
        var wc = new WNDCLASS { lpfnWndProc = _wndProc, hInstance = instance,
            hCursor = LoadCursor(IntPtr.Zero, 32512), lpszClassName = "CVRSizeModSlider" };
        RegisterClass(ref wc);

        _window = CreateWindowEx(WS_EX_TOPMOST, wc.lpszClassName, "ChilloutVR Size",
            WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_VISIBLE,
            CW_USEDEFAULT, CW_USEDEFAULT, 430, 125, IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
        if (_window == IntPtr.Zero) return;

        _label = CreateWindowEx(0, "STATIC", "Size: 1.0x", WS_CHILD | WS_VISIBLE,
            15, 12, 390, 25, _window, IntPtr.Zero, instance, IntPtr.Zero);
        _slider = CreateWindowEx(0, "msctls_trackbar32", "", WS_CHILD | WS_VISIBLE | TBS_AUTOTICKS,
            15, 45, 390, 35, _window, IntPtr.Zero, instance, IntPtr.Zero);

        SendMessage(_slider, TBM_SETRANGE, IntPtr.Zero, MakeRange(1, 50));
        SendMessage(_slider, TBM_SETPOS, new IntPtr(1), new IntPtr(10));
        _windowCreated = true;
        ShowWindow(_window, 5);
        UpdateWindow(_window);
    }

    private static IntPtr MakeRange(int min, int max) => new IntPtr(((long)max << 16) | (ushort)min);

    private static IntPtr WindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WM_HSCROLL && lParam == _slider)
        {
            int pos = SendMessage(_slider, TBM_GETPOS, IntPtr.Zero, IntPtr.Zero).ToInt32();
            SetScale(pos / 10.0f);
        }
        else if (msg == WM_CLOSE)
        {
            DestroyWindow(hWnd);
            return IntPtr.Zero;
        }
        else if (msg == WM_DESTROY)
        {
            _windowCreated = false;
            _window = IntPtr.Zero;
            _slider = IntPtr.Zero;
            _label = IntPtr.Zero;
            return IntPtr.Zero;
        }
        return DefWindowProc(hWnd, msg, wParam, lParam);
    }

    private static void CloseWindow()
    {
        if (_window != IntPtr.Zero) DestroyWindow(_window);
    }

    private static void SetScale(float value)
    {
        _scale = Math.Clamp(value, MinScale, MaxScale);
        if (_slider != IntPtr.Zero) SendMessage(_slider, TBM_SETPOS, new IntPtr(1), new IntPtr((int)(_scale * 10)));
        if (_label != IntPtr.Zero) SetWindowText(_label, $"Size: {_scale:0.0}x");
    }

    private static void ApplyScale()
    {
        try
        {
            object? player = GetLocalPlayerObject();
            if (player == null) return;
            object? go = GetProperty(player, "GameObject");
            object? transform = go == null ? null : GetProperty(go, "transform");
            if (transform == null) return;
            PropertyInfo? p = transform.GetType().GetProperty("localScale", BindingFlags.Public | BindingFlags.Instance);
            if (p == null || !p.CanWrite) return;
            object? value = Activator.CreateInstance(p.PropertyType);
            if (value == null) return;
            SetField(p.PropertyType, value, "x", _scale);
            SetField(p.PropertyType, value, "y", _scale);
            SetField(p.PropertyType, value, "z", _scale);
            p.SetValue(transform, value);
        }
        catch (Exception ex) { MelonLogger.Warning("Scale apply failed: " + ex.GetType().Name + ": " + ex.Message); }
    }

    private static object? GetLocalPlayerObject()
    {
        _localPlayerType ??= Type.GetType("CVR.LocalPlayer, Assembly-CSharp");
        if (_localPlayerType == null) return null;
        return _localPlayerType.GetProperty("PlayerObject", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
    }

    private static object? GetProperty(object instance, string name) =>
        instance.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance)?.GetValue(instance);

    private static void SetField(Type type, object instance, string name, float value)
    {
        FieldInfo? field = type.GetField(name, BindingFlags.Public | BindingFlags.Instance);
        if (field != null && field.FieldType == typeof(float)) field.SetValue(instance, value);
    }
}
