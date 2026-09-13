// VoiceChanger Direct uses the reconnecting Deepgram client.
// Keep the native Electron WebSocket untouched.
import './deepgram-key-guard.js';
import './output-sink-fix.js';
import './pocket-tts-fix.js';
import './natural-voice-fix.js';
import './tts-onset-fix.js';
import './main-fixed.js';
import './driver.js';
