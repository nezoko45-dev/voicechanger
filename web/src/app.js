// VoiceChanger Direct uses the reconnecting Deepgram client.
// Keep the native WebSocket implementation intact so Deepgram STT can start
// reliably. The live client itself handles reconnects after transient 1006s.
//
// IMPORTANT: patch order matters. pocket-tts-fix must wrap the ORIGINAL
// PocketTTS cloneVoice first. natural-voice-fix then wraps that safe version.
// Reversing these imports creates a recursive cloneVoice -> cloneVoice call and
// produces "Maximum call stack size exceeded" during voice cloning.
import './output-sink-fix.js';
import './pocket-tts-fix.js';
import './natural-voice-fix.js';
import './tts-onset-fix.js';
import './main-fixed.js';
import './driver.js';
