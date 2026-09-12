// VoiceChanger Direct intentionally uses the browser's native WebSocket for Deepgram.
// There is no Electron WebSocket/IPC bridge in the Direct desktop build.
import './pocket-tts-fix.js';
import './main-output.js';
import './driver.js';
