using System;
using System.Runtime.InteropServices;
using MelonLoader;

[assembly: MelonInfo(typeof(ChilloutVRSizeMod.Main), "ChilloutVR Size Mod", "1.0.6", "nezoko45-dev")]

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
    private static object? _localPlayer;
    private static bool _loggedPlayer;

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
    private const int PM_REMOVE = 0x0001;

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(int exStyle, string className, string windowName, int style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern ushort RegisterClass(ref WNDCLASS wc);
    [DllImport("user32.dll")] private static extern IntPtr DefWindowProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr LoadCursor(IntPtr instance, int cursor);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] private static extern bool UpdateWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool SetWindowText(IntPtr hWnd, string text);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out MSG msg, IntPtr hWnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref MSG msg);

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
        public string? lpszMenuName;
        public string lpszClassName;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    public override void OnApplicationStart()
    {
        MelonLogger.Msg("ChilloutVR Size Mod 1.0.6 loaded.");
        MelonLogger.Msg("F10 opens the size slider. F7/F8 change size. F9 resets.");
    }

    public override void OnUpdate()
    {
        PumpMessages();

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

    private static void PumpMessages()
    {
        try
        {
            while (PeekMessage(out MSG msg, IntPtr.Zero, 0, 0, PM_REMOVE))
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }
        }
        catch { }
    }

    private static void CreateSliderWindow()
    {
        try
        {
            _wndProc = WindowProc;
            IntPtr instance = GetModuleHandle(null);
            var wc = new WNDCLASS
            {
                lpfnWndProc = _wndProc,
                hInstance = instance,
                hCursor = LoadCursor(IntPtr.Zero, 32512),
                lpszClassName = "CVRSizeModSlider"
            };
            RegisterClass(ref wc);

            _window = CreateWindowEx(WS_EX_TOPMOST, wc.lpszClassName, "ChilloutVR Size",
                WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_VISIBLE,
                CW_USEDEFAULT, CW_USEDEFAULT, 430, 125, IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
            if (_window == IntPtr.Zero) return;

            _label = CreateWindowEx(0, "STATIC", "Size: 1.0x", WS_CHILD | WS_VISIBLE,
                15, 12, 390, 25, _window, IntPtr.Zero, instance, IntPtr.Zero);
            _slider = CreateWindowEx(0, "msctls_trackbar32", "", WS_CHILD | WS_VISIBLE | TBS_AUTOTICKS,
                15, 45, 390, 35, _window, IntPtr.Zero, instance, IntPtr.Zero);

            if (_slider == IntPtr.Zero)
            {
                CloseWindow();
                return;
            }

            SendMessage(_slider, TBM_SETRANGE, IntPtr.Zero, MakeRange(1, 50));
            SendMessage(_slider, TBM_SETPOS, new IntPtr(1), new IntPtr((int)(_scale * 10)));
            _windowCreated = true;
            ShowWindow(_window, 5);
            UpdateWindow(_window);
        }
        catch (Exception ex)
        {
            MelonLogger.Warning("Slider creation failed: " + ex.GetType().Name + ": " + ex.Message);
            _windowCreated = false;
            _window = IntPtr.Zero;
            _slider = IntPtr.Zero;
            _label = IntPtr.Zero;
        }
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
        _scale = Math.Max(MinScale, Math.Min(MaxScale, value));
        if (_slider != IntPtr.Zero) SendMessage(_slider, TBM_SETPOS, new IntPtr(1), new IntPtr((int)(_scale * 10)));
        if (_label != IntPtr.Zero) SetWindowText(_label, $"Size: {_scale:0.0}x");
    }

    private static void ApplyScale()
    {
        try
        {
            object? player = GetLocalPlayerObject();
            if (player == null) return;

            object? gameObject = GetMember(player, "GameObject");
            object? transform = gameObject != null ? GetMember(gameObject, "transform") : null;
            if (transform == null)
            {
                object? directTransform = GetMember(player, "transform");
                if (directTransform != null) transform = directTransform;
            }
            if (transform == null) return;

            object? currentScale = GetMember(transform, "localScale");
            if (currentScale == null) return;

            SetFloatMember(currentScale, "x", _scale);
            SetFloatMember(currentScale, "y", _scale);
            SetFloatMember(currentScale, "z", _scale);
            SetMember(transform, "localScale", currentScale);

            if (!_loggedPlayer)
            {
                _loggedPlayer = true;
                MelonLogger.Msg("Local player found. Scale is being applied.");
            }
        }
        catch (Exception ex)
        {
            MelonLogger.Warning("Scale apply failed: " + ex.GetType().Name + ": " + ex.Message);
        }
    }

    private static object? GetLocalPlayerObject()
    {
        if (_localPlayer != null) return _localPlayer;

        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            try
            {
                Type? type = assembly.GetType("CVR.LocalPlayer", false);
                if (type == null) continue;
                object? value = GetStaticMember(type, "PlayerObject");
                if (value != null)
                {
                    _localPlayer = value;
                    return value;
                }
            }
            catch { }
        }
        return null;
    }

    private static object? GetStaticMember(Type type, string name)
    {
        try
        {
            return type.GetField(name, System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)?.GetValue(null);
        }
        catch { }
        try
        {
            return type.GetProperty(name, System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)?.GetValue(null);
        }
        catch { }
        return null;
    }

    private static object? GetMember(object instance, string name)
    {
        try
        {
            var flags = System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
            var field = instance.GetType().GetField(name, flags);
            if (field != null) return field.GetValue(instance);
            var property = instance.GetType().GetProperty(name, flags);
            return property?.GetValue(instance);
        }
        catch { return null; }
    }

    private static void SetMember(object instance, string name, object value)
    {
        try
        {
            var flags = System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
            var field = instance.GetType().GetField(name, flags);
            if (field != null && !field.IsInitOnly) { field.SetValue(instance, value); return; }
            var property = instance.GetType().GetProperty(name, flags);
            if (property != null && property.CanWrite) property.SetValue(instance, value);
        }
        catch { }
    }

    private static void SetFloatMember(object instance, string name, float value)
    {
        try
        {
            var flags = System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
            var field = instance.GetType().GetField(name, flags);
            if (field != null && field.FieldType == typeof(float)) { field.SetValue(instance, value); return; }
            var property = instance.GetType().GetProperty(name, flags);
            if (property != null && property.CanWrite && property.PropertyType == typeof(float)) property.SetValue(instance, value);
        }
        catch { }
    }
}
