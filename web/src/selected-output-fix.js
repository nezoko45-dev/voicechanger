import { PocketTTS } from "pocket-tts-js";

// Mark only live VoiceChanger conversion synthesis for selected-device playback.
// Manual TTS preview keeps its existing playback path. The tts-onset wrapper then
// sends marked conversion sentences through HTMLAudioElement.setSinkId().
const originalGenerate = PocketTTS.prototype.generate;

PocketTTS.prototype.generate = function (text, options = {}) {
  const stopButton = document.getElementById("stopVC");
  const startButton = document.getElementById("startVC");
  const liveConversion = !!stopButton && !stopButton.disabled && !!startButton?.disabled;

  if (!liveConversion || options.outputToSelectedDevice === true) {
    return originalGenerate.call(this, text, options);
  }

  return originalGenerate.call(this, text, {
    ...options,
    outputToSelectedDevice: true
  });
};
