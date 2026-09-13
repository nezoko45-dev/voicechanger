// VoiceChanger Direct uses the browser's native Deepgram WebSocket and
// Pocket TTS renderer. Keep the preload intentionally minimal so no stale
// RVC IPC objects or structured-clone payloads can throw Electron exceptions.
window.voicechangerDesktop = true;
