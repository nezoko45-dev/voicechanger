// VoiceChanger Direct uses the reconnecting Deepgram client.
// Install credential and low-latency guards BEFORE the Deepgram WebSocket is constructed.
import './deepgram-key-guard.js';
import './output-sink-fix.js';
import './pocket-tts-fix.js';
import './natural-voice-fix.js';
import './tts-onset-fix.js';
import './fast-latency.js';
import './main-fixed.js';
import './driver.js';
