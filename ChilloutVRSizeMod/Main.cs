using System;
using System.Reflection;
using System.Runtime.InteropServices;
using MelonLoader;

[assembly: MelonInfo(typeof(ChilloutVRSizeMod.Main), "ChilloutVR Size Mod", "1.0.3", "nezoko45-dev")]

namespace ChilloutVRSizeMod;

public sealed class Main : MelonMod
{
    private const float DefaultScale = 1f;
    private const float Step = 0.1f;
    private const float MinScale = 0.1f;
    private const float MaxScale = 5f;

    private static float _scale = DefaultScale;
    private static bool _f7WasDown;
    private static bool _f8WasDown;
    private static bool _f9WasDown;
    private static bool _loggedPlayerFound;
    private static Type? _localPlayerType;

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    private static bool IsKeyPressedOnce(int virtualKey, ref bool wasDown)
    {
        bool isDown = (GetAsyncKeyState(virtualKey) & 0x8000) != 0;
        bool pressed = isDown && !wasDown;
        wasDown = isDown;
        return pressed;
    }

    public override void OnApplicationStart()
    {
        MelonLogger.Msg("ChilloutVR Size Mod loaded.");
        MelonLogger.Msg("F7 = smaller | F8 = larger | F9 = reset");
    }

    public override void OnUpdate()
    {
        if (IsKeyPressedOnce(0x76, ref _f7WasDown))
            SetScale(_scale - Step);
        else if (IsKeyPressedOnce(0x77, ref _f8WasDown))
            SetScale(_scale + Step);
        else if (IsKeyPressedOnce(0x78, ref _f9WasDown))
            SetScale(DefaultScale);

        ApplyScale();
    }

    private static void SetScale(float value)
    {
        _scale = Math.Clamp(value, MinScale, MaxScale);
        MelonLogger.Msg($"Player scale: {_scale:0.0}x");
    }

    private static void ApplyScale()
    {
        try
        {
            object? playerObject = GetLocalPlayerObject();
            if (playerObject == null)
                return;

            object? gameObject = GetProperty(playerObject, "GameObject");
            if (gameObject == null)
                return;

            object? transform = GetProperty(gameObject, "transform");
            if (transform == null)
                return;

            PropertyInfo? localScaleProperty = transform.GetType().GetProperty(
                "localScale", BindingFlags.Public | BindingFlags.Instance);
            if (localScaleProperty == null || !localScaleProperty.CanWrite)
                return;

            Type scaleType = localScaleProperty.PropertyType;
            object? scaleValue = Activator.CreateInstance(scaleType);
            if (scaleValue == null)
                return;

            SetField(scaleType, scaleValue, "x", _scale);
            SetField(scaleType, scaleValue, "y", _scale);
            SetField(scaleType, scaleValue, "z", _scale);
            localScaleProperty.SetValue(transform, scaleValue);

            if (!_loggedPlayerFound)
            {
                _loggedPlayerFound = true;
                MelonLogger.Msg("Local player found and scale applied.");
            }
        }
        catch (Exception ex)
        {
            MelonLogger.Warning($"Could not apply player scale yet: {ex.GetType().Name}: {ex.Message}");
        }
    }

    private static object? GetLocalPlayerObject()
    {
        _localPlayerType ??= Type.GetType("CVR.LocalPlayer, Assembly-CSharp");
        if (_localPlayerType == null)
            return null;

        PropertyInfo? property = _localPlayerType.GetProperty(
            "PlayerObject", BindingFlags.Public | BindingFlags.Static);
        return property?.GetValue(null);
    }

    private static object? GetProperty(object instance, string name)
    {
        PropertyInfo? property = instance.GetType().GetProperty(
            name, BindingFlags.Public | BindingFlags.Instance);
        return property?.GetValue(instance);
    }

    private static void SetField(Type type, object instance, string name, float value)
    {
        FieldInfo? field = type.GetField(name, BindingFlags.Public | BindingFlags.Instance);
        if (field != null && field.FieldType == typeof(float))
            field.SetValue(instance, value);
    }
}
