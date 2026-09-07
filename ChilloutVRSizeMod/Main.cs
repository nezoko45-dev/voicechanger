using System;
using System.Reflection;
using System.Runtime.InteropServices;
using MelonLoader;
using UnityEngine;

[assembly: MelonInfo(typeof(ChilloutVRSizeMod.Main), "ChilloutVR Size Mod", "1.0.2", "nezoko45-dev")]

namespace ChilloutVRSizeMod;

public sealed class Main : MelonMod
{
    private const float DefaultScale = 1f;
    private const float Step = 0.1f;
    private const float MinScale = 0.1f;
    private const float MaxScale = 5f;

    private static MelonPreferences_Category? _category;
    private static MelonPreferences_Entry<float>? _scaleEntry;
    private static Transform? _playerRoot;
    private static Type? _localPlayerType;

    private static bool _f7WasDown;
    private static bool _f8WasDown;
    private static bool _f9WasDown;
    private static bool _loggedPlayerFound;

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    private static bool IsKeyPressedOnce(int virtualKey, ref bool wasDown)
    {
        var isDown = (GetAsyncKeyState(virtualKey) & 0x8000) != 0;
        var pressed = isDown && !wasDown;
        wasDown = isDown;
        return pressed;
    }

    public override void OnApplicationStart()
    {
        _category = MelonPreferences.CreateCategory("ChilloutVR Size Mod");
        _scaleEntry = _category.CreateEntry("Scale", DefaultScale, "Local player scale");

        MelonLogger.Msg("ChilloutVR Size Mod loaded.");
        MelonLogger.Msg("F7 = smaller | F8 = larger | F9 = reset");
    }

    public override void OnUpdate()
    {
        if (_scaleEntry == null)
            return;

        if (IsKeyPressedOnce(0x76, ref _f7WasDown))
            SetScale(_scaleEntry.Value - Step);
        else if (IsKeyPressedOnce(0x77, ref _f8WasDown))
            SetScale(_scaleEntry.Value + Step);
        else if (IsKeyPressedOnce(0x78, ref _f9WasDown))
            SetScale(DefaultScale);

        ApplyScale();
    }

    private static void SetScale(float value)
    {
        if (_scaleEntry == null)
            return;

        _scaleEntry.Value = Mathf.Clamp(value, MinScale, MaxScale);
        MelonLogger.Msg($"Player scale: {_scaleEntry.Value:0.0}x");
    }

    private static void ApplyScale()
    {
        if (_scaleEntry == null)
            return;

        if (!TryGetLocalPlayerRoot(out var root))
            return;

        _playerRoot = root;
        var target = Vector3.one * _scaleEntry.Value;

        if ((root.localScale - target).sqrMagnitude > 0.000001f)
            root.localScale = target;

        if (!_loggedPlayerFound)
        {
            _loggedPlayerFound = true;
            MelonLogger.Msg($"Local player found: {root.name}");
            MelonLogger.Msg($"Applied player scale: {_scaleEntry.Value:0.0}x");
        }
    }

    private static bool TryGetLocalPlayerRoot(out Transform root)
    {
        root = null!;

        try
        {
            _localPlayerType ??= Type.GetType("CVR.LocalPlayer, Assembly-CSharp");
            if (_localPlayerType == null)
            {
                MelonLogger.Warning("CVR.LocalPlayer type has not loaded yet.");
                return false;
            }

            var playerObjectProperty = _localPlayerType.GetProperty(
                "PlayerObject",
                BindingFlags.Public | BindingFlags.Static);

            if (playerObjectProperty == null)
            {
                MelonLogger.Warning("CVR.LocalPlayer.PlayerObject property was not found.");
                return false;
            }

            var player = playerObjectProperty.GetValue(null);
            if (player == null)
                return false;

            var gameObjectProperty = player.GetType().GetProperty(
                "GameObject",
                BindingFlags.Public | BindingFlags.Instance);

            if (gameObjectProperty == null)
            {
                MelonLogger.Warning("CVR.Player.GameObject property was not found.");
                return false;
            }

            var gameObject = gameObjectProperty.GetValue(player) as GameObject;
            if (gameObject == null)
                return false;

            root = gameObject.transform;
            return root != null;
        }
        catch (Exception ex)
        {
            MelonLogger.Warning($"Could not locate the local player yet: {ex.Message}");
            return false;
        }
    }
}
