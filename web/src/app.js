// VoiceChanger Direct uses the reconnecting Deepgram client.
// main-fixed.js keeps the live STT session alive by automatically reconnecting
// after transient WebSocket 1006 disconnects instead of leaving the UI stopped.
import './pocket-tts-fix.js';
import './main-fixed.js';
import './driver.js';
