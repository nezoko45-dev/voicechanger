// Minimal renderer entrypoint for VoiceChanger Direct.
// Keep routing patches local to Pocket TTS; do not replace global WebSocket/AudioContext constructors.
import './tts-onset-fix.js';
import './selected-output-fix.js';
import './main-fixed.js';
import './driver.js';
