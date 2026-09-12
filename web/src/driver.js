const find = (id) => document.getElementById(id);

// VoiceMeeter's current VAIO layout numbers virtual inputs 1-8.
// Index 8 is the VAIO3 Input on Potato, exposed to Windows as
// "Voicemeeter VAIO3 Input" / "Voicemeeter VAIO3 Input (VB-Audio Voicemeeter VAIO)".
const isVoiceMeeterIndex8 = (label) => /voicemeeter.*(?:vaio3|in\s*8|input\s*8)/i.test(label || '');

function findVoiceMeeterOutput(devices) {
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  return outputs.find((d) => isVoiceMeeterIndex8(d.label))
    || outputs.find((d) => /voicemeeter.*(?:input|vaio)|vb-audio.*voicemeeter/i.test(d.label || ''))
    || null;
}

function findMagicMicOutput(devices) {
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  return outputs.find((d) => /magic mic(?!.*microphone)|voicechanger|virtual audio driver|virtual.?speaker/i.test(d.label || '')) || null;
}

function findVoiceMeeterInput(devices) {
  const inputs = devices.filter((d) => d.kind === 'audioinput');
  return inputs.find((d) => /voicemeeter.*(?:out|output|b1)|vb-audio.*voicemeeter.*out/i.test(d.label || '')) || null;
}

function findMagicMicInput(devices) {
  const inputs = devices.filter((d) => d.kind === 'audioinput');
  return inputs.find((d) => /magic mic.*microphone|magic mic|virtual mic driver|voicechanger/i.test(d.label || '')) || null;
}

async function enumerateRoutingDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return { voiceMeeterOutput: null, voiceMeeterInput: null, magicMicOutput: null, magicMicInput: null };
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      voiceMeeterOutput: findVoiceMeeterOutput(devices),
      voiceMeeterInput: findVoiceMeeterInput(devices),
      magicMicOutput: findMagicMicOutput(devices),
      magicMicInput: findMagicMicInput(devices),
    };
  } catch (error) {
    appendDriverLog(`AUDIO DEVICE ENUMERATION ERROR: ${error.message}`);
    return { voiceMeeterOutput: null, voiceMeeterInput: null, magicMicOutput: null, magicMicInput: null };
  }
}

async function selectPreferredOutput({ requireDevice = false } = {}) {
  const select = find('outputDevice');
  if (!select || !navigator.mediaDevices?.enumerateDevices) return null;
  try {
    const devices = await enumerateRoutingDevices();
    const preferred = devices.voiceMeeterOutput || devices.magicMicOutput;
    if (!preferred) {
      if (requireDevice) appendDriverLog('No VoiceMeeter or Magic Mic output was found.');
      return null;
    }
    const option = [...select.options].find((item) => item.value === preferred.deviceId);
    if (!option) select.add(new Option(preferred.label || 'VoiceMeeter VAIO3 Input (index 8)', preferred.deviceId));
    select.value = preferred.deviceId;
    localStorage.setItem('voicechanger.outputDevice', preferred.deviceId);
    localStorage.setItem('voicechanger.outputRoute', devices.voiceMeeterOutput ? 'voicemeeter-index-8' : 'magic-mic');
    if (devices.voiceMeeterOutput) {
      setDriverStatus(isVoiceMeeterIndex8(devices.voiceMeeterOutput.label)
        ? '✓ VoiceMeeter index 8 (VAIO3 Input) is selected as the primary TTS output.'
        : '✓ VoiceMeeter was found, but its index-8 VAIO3 endpoint was not exposed; using the main VoiceMeeter Input.', 'ok');
    } else {
      setDriverStatus('✓ VoiceMeeter was not found. Magic Mic is selected as the fallback TTS output.', 'working');
    }
    return preferred;
  } catch (error) {
    appendDriverLog(`AUDIO OUTPUT ERROR: ${error.message}`);
    return null;
  }
}

function installTtsPlaybackRouter() {
  // Browser mode plays TTS directly from main.js. Keep this hook only for old Electron builds.
  if (!window.nativeAudio?.playWavBase64 || window.nativeAudio.__ttsRouterInstalled) return;
  const nativeFallback = window.nativeAudio.playWavBase64.bind(window.nativeAudio);
  const state = { audio: null, url: null };
  window.nativeAudio.playWavBase64 = async (base64) => {
    const select = find('outputDevice');
    const outputId = select?.value || localStorage.getItem('voicechanger.outputDevice') || '';
    if (!outputId || outputId === 'default' || typeof HTMLMediaElement.prototype.setSinkId !== 'function') return nativeFallback(base64);
    try {
      if (state.audio) { try { state.audio.pause(); } catch {} }
      if (state.url) URL.revokeObjectURL(state.url);
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      state.url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      const audio = new Audio(state.url);
      state.audio = audio;
      await audio.setSinkId(outputId);
      await audio.play();
      return true;
    } catch (error) {
      appendDriverLog(`TTS OUTPUT ERROR: ${error.message}`);
      return nativeFallback(base64);
    }
  };
  window.nativeAudio.__ttsRouterInstalled = true;
}

function addDriverCard() {
  if (find('driverCard')) return;
  const grid = document.querySelector('.grid');
  if (!grid) return;

  const card = document.createElement('div');
  card.id = 'driverCard';
  card.className = 'card wide';
  card.innerHTML = `
    <h2>🎛️ TTS Audio Routing</h2>
    <div class="stack">
      <div id="driverStatus" class="status working">Checking VoiceMeeter index 8…</div>
      <div class="row">
        <button id="routeVoiceMeeter">Use VoiceMeeter Index 8</button>
        <button id="routeMagicMic" class="secondary">Use Magic Mic Fallback</button>
        <button id="refreshDriver" class="secondary">Refresh Audio Devices</button>
      </div>
      <div class="hint">
        <b>Primary:</b> VoiceMeeter virtual input index 8 (VAIO3 Input on Potato). <b>Fallback:</b> Magic Mic. TTS is played by the browser directly into the selected Windows playback endpoint.
      </div>
    </div>`;

  grid.insertBefore(card, grid.firstElementChild);

  find('routeVoiceMeeter').addEventListener('click', async () => {
    const devices = await enumerateRoutingDevices();
    if (!devices.voiceMeeterOutput) {
      setDriverStatus('VoiceMeeter was not found. Make sure its virtual audio devices are enabled in Windows.', 'bad');
      appendDriverLog('VOICE MEETER NOT FOUND: expected the index-8 VAIO3 Input or a VoiceMeeter Input playback endpoint.');
      return;
    }
    const exact = isVoiceMeeterIndex8(devices.voiceMeeterOutput.label);
    await selectOutputDevice(devices.voiceMeeterOutput, exact ? 'voicemeeter-index-8' : 'voicemeeter');
    setDriverStatus(exact
      ? '✓ TTS is routed to VoiceMeeter index 8 (VAIO3 Input).'
      : '⚠ Index 8 was not exposed by this VoiceMeeter installation; TTS is using the main VoiceMeeter Input.', exact ? 'ok' : 'working');
  });

  find('routeMagicMic').addEventListener('click', async () => {
    const devices = await enumerateRoutingDevices();
    if (!devices.magicMicOutput) {
      setDriverStatus('Magic Mic output was not found.', 'bad');
      return;
    }
    await selectOutputDevice(devices.magicMicOutput, 'magic-mic');
    setDriverStatus('✓ TTS is now routed through Magic Mic.', 'ok');
  });

  find('refreshDriver').addEventListener('click', checkDriverStatus);
}

async function selectOutputDevice(device, route) {
  const select = find('outputDevice');
  if (select) {
    const option = [...select.options].find((item) => item.value === device.deviceId);
    if (!option) select.add(new Option(device.label || route, device.deviceId));
    select.value = device.deviceId;
  }
  localStorage.setItem('voicechanger.outputDevice', device.deviceId);
  localStorage.setItem('voicechanger.outputRoute', route);
  return device;
}

function setDriverStatus(text, type = '') {
  const box = find('driverStatus');
  if (!box) return;
  box.textContent = text;
  box.className = `status ${type}`;
}

function appendDriverLog(text) {
  const log = find('log');
  if (!log || !text) return;
  log.textContent = `${new Date().toLocaleTimeString()} — ${String(text).trim()}\n${log.textContent}`;
}

async function checkDriverStatus() {
  setDriverStatus('Checking VoiceMeeter index 8 and Magic Mic audio devices…', 'working');
  const devices = await enumerateRoutingDevices();
  const savedRoute = localStorage.getItem('voicechanger.outputRoute');

  if (savedRoute === 'magic-mic' && devices.magicMicOutput) {
    await selectOutputDevice(devices.magicMicOutput, 'magic-mic');
    setDriverStatus('✓ Magic Mic fallback is selected.', 'working');
    return;
  }

  if (devices.voiceMeeterOutput) {
    const exact = isVoiceMeeterIndex8(devices.voiceMeeterOutput.label);
    await selectOutputDevice(devices.voiceMeeterOutput, exact ? 'voicemeeter-index-8' : 'voicemeeter');
    setDriverStatus(exact
      ? '✓ VoiceMeeter index 8 (VAIO3 Input) is ready and selected.'
      : '⚠ VoiceMeeter index 8 was not exposed; main VoiceMeeter Input is selected.', exact ? 'ok' : 'working');
    return;
  }

  if (devices.magicMicOutput) {
    await selectOutputDevice(devices.magicMicOutput, 'magic-mic');
    setDriverStatus('⚠ VoiceMeeter was not detected. Magic Mic has been selected as the fallback.', 'working');
    return;
  }

  setDriverStatus('⚠ No VoiceMeeter or Magic Mic virtual output was found. Install/enable one in Windows Sound.', 'bad');
}

window.addEventListener('DOMContentLoaded', () => {
  installTtsPlaybackRouter();
  addDriverCard();
  checkDriverStatus();
});