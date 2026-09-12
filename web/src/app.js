// VoiceChanger Direct uses the reconnecting Deepgram client.
// Keep the native WebSocket implementation intact so Deepgram STT can start
// reliably. The live client itself handles reconnects after transient 1006s.
import './output-sink-fix.js';
import './pocket-tts-fix.js';
import './tts-onset-fix.js';
import './main-fixed.js';
import './driver.js';
