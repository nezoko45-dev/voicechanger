// VoiceChanger Direct uses the reconnecting Deepgram client.
// Install the credential guard BEFORE any Deepgram WebSocket is constructed.
import './deepgram-key-guard.js';
import './output-sink-fix.js';
import './pocket-tts-fix.js';
import './natural-voice-fix.js';
import './tts-onset-fix.js';
import './main-fixed.js';
import './rvc-pocket.js';
import './driver.js';
