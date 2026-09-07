using System;
using System.Reflection;
using MelonLoader;
using UnityEngine;

[assembly: MelonInfo(typeof(ChilloutVRSizeMod.Main), "ChilloutVR Size Mod", "1.0.0", "nezoko45-dev")]
[assembly: MelonGame("Alpha Blend Interactive", "ChilloutVR")]

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
    private static float _lastApplied = -1f;
    private static Type? _localPlayerType;

    public override void OnApplicationStart()
    {
        _category = MelonPreferences.CreateCategory("ChilloutVR Size Mod");
        _scaleEntry = _category.CreateEntry("Scale", DefaultScale, "Avatar/player scale", validator: new MelonLoader.Utils.ValueRange<float>(MinScale, MaxScale));

        MelonLogger.Msg("ChilloutVR Size Mod loaded.");
        MelonLogger.Msg("F7 = smaller | F8 = larger | F9 = reset");
    }

    public override void OnUpdate()
    {
        if (_scaleEntry == null)
            return;

        if (Input.GetKeyDown(KeyCode.F7))
            SetScale(_scaleEntry.Value - Step);
        else if (Input.GetKeyDown(KeyCode.F8))
            SetScale(_scaleEntry.Value + Step);
        else if (Input.GetKeyDown(KeyCode.F9))
            SetScale(DefaultScale);

        ApplyScaleIfNeeded();
    }

    private static void SetScale(float value)
    {
        if (_scaleEntry == null)
            return;

        _scaleEntry.Value = Mathf.Clamp(value, MinScale, MaxScale);
        _category?.SaveToFile(false);
        _lastApplied = -1f;
    }

    private static void ApplyScaleIfNeeded()
    {
        if (_scaleEntry == null)
            return;

        if (!TryGetLocalPlayerRoot(out var root))
            return;

        if (Mathf.Approximately(_lastApplied, _scaleEntry.Value) && root == _playerRoot)
            return;

        _playerRoot = root;
        root.localScale = Vector3.one * _scaleEntry.Value;
        _lastApplied = _scaleEntry.Value;
    }

    private static bool TryGetLocalPlayerRoot(out Transform root)
    {
        root = null!;

        try
        {
            _localPlayerType ??= Type.GetType("CVR.LocalPlayer, Assembly-CSharp");
            if (_localPlayerType == null)
                return false;

            var playerObjectProperty = _localPlayerType.GetProperty(
                "PlayerObject",
                BindingFlags.Public | BindingFlags.Static);

            var player = playerObjectProperty?.GetValue(null);
            if (player == null)
                return false;

            var gameObjectProperty = player.GetType().GetProperty(
                "GameObject",
                BindingFlags.Public | BindingFlags.Instance);

            var gameObject = gameObjectProperty?.GetValue(player) as GameObject;
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
