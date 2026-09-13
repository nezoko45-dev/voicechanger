// Keep the renderer dependency chain deliberately small and native.
// Previous global monkey-patches of WebSocket/AudioContext/PocketTTS were a
// source of Electron renderer JavaScript exceptions. Device routing is handled
// directly by main-fixed.js and driver.js.
import './deepgram-key-guard.js';
import './main-fixed.js';
import './driver.js';
