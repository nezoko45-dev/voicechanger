// Intentionally empty.
// VoiceChanger now uses native AudioContext({ sinkId }) and HTMLAudioElement.setSinkId()
// directly. Replacing browser constructors with Proxy objects caused Electron renderer
// JavaScript exceptions in some Chromium builds, so no global Web Audio monkey-patching
// is performed here.
export {};
