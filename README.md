# Unity VoiceChanger

Clean Windows Unity/C# realtime voicechanger foundation.

Pipeline: Microphone -> Unity realtime audio processor -> Windows output -> Voicemeeter/VRChat.

This build is local: no Deepgram Agent, no Hugging Face inference, and no Python backend.

Open with Unity 6000.2.6f2 or newer and open Assets/Scenes/Main.unity.

The first build provides the native realtime audio path and a low-latency pitch-style effect. Unity itself is not an AI voice-cloning model; a neural conversion engine can be plugged into this processing stage later without replacing the UI/audio layer.
