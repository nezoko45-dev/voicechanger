// Deprecated Electron WebSocket monkey-patch removed.
//
// This file intentionally does not replace window.WebSocket or modify its
// read-only CONNECTING/OPEN/CLOSING/CLOSED properties. Deepgram now uses the
// native renderer WebSocket path from main-fixed.js, while Electron IPC stays
// available for other desktop features.
export {};
