// Deepgram latency tuning is handled by the native reconnecting client in main-fixed.js.
// This module is intentionally a no-op: Electron/Chromium WebSocket constructors
// expose read-only state properties, so replacing or proxying window.WebSocket can
// cause uncaught renderer exceptions.
export {};
