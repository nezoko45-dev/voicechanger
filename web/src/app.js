// VoiceChanger Direct uses the reconnecting Deepgram client.
// Install the credential guard BEFORE any Deepgram WebSocket is constructed.
// This prevents clone/TTS error messages from ever being used as a subprotocol.
import './deepgram-key-guard.js';
import './output-sink-fix.js';
import './pocket-tts-fix.js';
import './natural-voice-fix.js';
import './tts-onset-fix.js';
import './main-fixed.js';
import './driver.js';
