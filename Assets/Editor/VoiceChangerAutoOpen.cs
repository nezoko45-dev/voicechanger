#if UNITY_EDITOR
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

[InitializeOnLoad]
public static class VoiceChangerAutoOpen
{
    static VoiceChangerAutoOpen()
    {
        EditorApplication.delayCall += OpenMainScene;
    }

    static void OpenMainScene()
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode)
            return;

        const string scenePath = "Assets/Scenes/Main.unity";

        if (System.IO.File.Exists(scenePath) &&
            EditorSceneManager.GetActiveScene().path != scenePath)
        {
            EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
        }
    }
}
#endif
