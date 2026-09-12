const find = (id) => document.getElementById(id);

function findVoiceMeeterOutput(devices) {
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  return outputs.find((d) => /voicemeeter.*(?:input|vaio)|vb-audio.*voicemeeter/i.test(d.label || '')) || null;
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
    if (!option) select.add(new Option(preferred.label || 'VoiceMeeter Input', preferred.deviceId));
    select.value = preferred.deviceId;
    localStorage.setItem('voicechanger.outputDevice', preferred.deviceId);
    localStorage.setItem('voicechanger.outputRoute', devices.voiceMeeterOutput ? 'voicemeeter' : 'magic-mic');
    if (devices.voiceMeeterOutput) {
      setDriverStatus('✓ VoiceMeeter Input is selected as the primary TTS output.', 'ok');
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
  if (!window.nativeAudio?.playWavBase64 || window.nativeAudio.__ttsRouterInstalled) return;
  const nativeFallback = window.nativeAudio.playWavBase64.bind(window.nativeAudio);
  const state = { audio: null, url: null };

  window.nativeAudio.playWavBase64 = async (base64) => {
    const select = find('outputDevice');
    const outputId = select?.value || localStorage.getItem('voicechanger.outputDevice') || '';
    if (!outputId || outputId === 'default' || typeof HTMLMediaElement.prototype.setSinkId !== 'function') {
      return nativeFallback(base64);
    }

    try {
      if (state.audio) {
        try { state.audio.pause(); } catch {}
      }
      if (state.url) URL.revokeObjectURL(state.url);
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      state.url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      const audio = new Audio(state.url);
      state.audio = audio;
      await audio.setSinkId(outputId);
      await audio.play();
      audio.addEventListener('ended', () => {
        if (state.url) {
          URL.revokeObjectURL(state.url);
          state.url = null;
        }
        if (state.audio === audio) state.audio = null;
      }, { once: true });
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
      <div id="driverStatus" class="status working">Checking VoiceMeeter and Magic Mic…</div>
      <div class="row">
        <button id="routeVoiceMeeter">Use VoiceMeeter</button>
        <button id="routeMagicMic" class="secondary">Use Magic Mic Fallback</button>
        <button id="refreshDriver" class="secondary">Refresh Audio Devices</button>
      </div>
      <div class="hint">
        <b>Primary:</b> VoiceMeeter Input. <b>Fallback:</b> Magic Mic. Pocket TTS is sent directly to the selected Windows virtual playback device. VoiceMeeter's matching output can then be selected as the microphone by Discord, VRChat, OBS, games, and other apps.
      </div>
    </div>`;

  grid.insertBefore(card, grid.firstElementChild);

  find('routeVoiceMeeter').addEventListener('click', async () => {
    const devices = await enumerateRoutingDevices();
    if (!devices.voiceMeeterOutput) {
      setDriverStatus('VoiceMeeter Input was not found. Make sure VoiceMeeter is installed and its virtual audio devices are enabled in Windows.', 'bad');
      appendDriverLog('VOICE MEETER NOT FOUND: expected a VoiceMeeter Input / VAIO playback device.');
      return;
    }
    await selectOutputDevice(devices.voiceMeeterOutput, 'voicemeeter');
    setDriverStatus('✓ TTS is now routed through VoiceMeeter Input. Use VoiceMeeter Out B1 / Output as the microphone in your target app.', 'ok');
  });

  find('routeMagicMic').addEventListener('click', async () => {
    const devices = await enumerateRoutingDevices();
    if (!devices.magicMicOutput) {
      setDriverStatus('Magic Mic output was not found. Install the Magic Mic driver first.', 'bad');
      return;
    }
    await selectOutputDevice(devices.magicMicOutput, 'magic-mic');
    setDriverStatus('✓ TTS is now routed through Magic Mic. Use Magic Mic Microphone as the microphone in your target app.', 'ok');
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
  setDriverStatus('Checking VoiceMeeter and Magic Mic audio devices…', 'working');
  const devices = await enumerateRoutingDevices();
  const savedRoute = localStorage.getItem('voicechanger.outputRoute');

  if (savedRoute === 'magic-mic' && devices.magicMicOutput) {
    await selectOutputDevice(devices.magicMicOutput, 'magic-mic');
    setDriverStatus('✓ Magic Mic fallback is selected.', 'working');
    return;
  }

  if (devices.voiceMeeterOutput) {
    await selectOutputDevice(devices.voiceMeeterOutput, 'voicemeeter');
    setDriverStatus('✓ VoiceMeeter Input is ready and selected as the primary TTS output.', 'ok');
    return;
  }

  if (devices.magicMicOutput) {
    await selectOutputDevice(devices.magicMicOutput, 'magic-mic');
    setDriverStatus('⚠ VoiceMeeter was not detected. Magic Mic has been selected as the fallback.', 'working');
    return;
  }

  setDriverStatus('⚠ No VoiceMeeter or Magic Mic virtual output was found. Install/enable one of them in Windows Sound.', 'bad');
}

window.addEventListener('DOMContentLoaded', () => {
  installTtsPlaybackRouter();
  addDriverCard();
  checkDriverStatus();
});