const find = (id) => document.getElementById(id);

function findVoiceChangerOutput(devices) {
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  return outputs.find((d) => /voicechanger|virtual audio driver|virtual.?audio|virtual.?speaker/i.test(d.label || '')) || null;
}

async function selectVoiceChangerOutput({ requireDriver = false } = {}) {
  const select = find('outputDevice');
  if (!select || !navigator.mediaDevices?.enumerateDevices) return null;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const output = findVoiceChangerOutput(devices);
    if (!output) {
      if (requireDriver) appendDriverLog('VoiceChanger virtual output is not visible yet. Windows may need a moment to register the driver.');
      return null;
    }
    const option = [...select.options].find((item) => item.value === output.deviceId);
    if (!option) select.add(new Option(output.label || 'VoiceChanger Driver', output.deviceId));
    select.value = output.deviceId;
    localStorage.setItem('voicechanger.outputDevice', output.deviceId);
    setDriverStatus('✓ VoiceChanger Driver installed and selected as the TTS output.', 'ok');
    return output;
  } catch (error) {
    appendDriverLog(`VOICECHANGER OUTPUT ERROR: ${error.message}`);
    return null;
  }
}

function addDriverCard() {
  if (find('driverCard')) return;
  const grid = document.querySelector('.grid');
  if (!grid) return;

  const card = document.createElement('div');
  card.id = 'driverCard';
  card.className = 'card wide';
  card.innerHTML = `
    <h2>🎛️ VoiceChanger Driver</h2>
    <div class="stack">
      <div id="driverStatus" class="status working">Checking the virtual audio driver…</div>
      <div class="row">
        <button id="installDriver">Install VoiceChanger Driver</button>
        <button id="uninstallDriver" class="danger">Remove Driver</button>
        <button id="refreshDriver" class="secondary">Refresh Driver Status</button>
        <button id="routeDriver" class="secondary">Route TTS Through VoiceChanger Driver</button>
      </div>
      <div class="hint">
        The bundled VoiceChanger driver creates the Windows virtual audio endpoints. TTS is routed to its virtual speaker automatically, and apps such as ChilloutVR can select the matching virtual microphone endpoint.
      </div>
    </div>`;

  grid.insertBefore(card, grid.firstElementChild);

  find('installDriver').addEventListener('click', async () => {
    const button = find('installDriver');
    button.disabled = true;
    setDriverStatus('Installing the VoiceChanger virtual audio driver…', 'working');
    try {
      const result = await window.nativeAudio?.driverInstall?.();
      if (!result?.ok) throw new Error(result?.output || 'Driver installation failed.');
      setDriverStatus('✓ VoiceChanger Driver installed. Registering its Windows audio endpoints…', 'working');
      appendDriverLog(result.output);
      try { find('refreshOutputs')?.click(); } catch {}
      setTimeout(() => { selectVoiceChangerOutput({ requireDriver: true }); }, 1200);
      setTimeout(() => { selectVoiceChangerOutput({ requireDriver: true }); }, 3000);
    } catch (error) {
      setDriverStatus(`Driver install failed: ${error.message}`, 'bad');
      appendDriverLog(`DRIVER INSTALL ERROR: ${error.stack || error.message}`);
    } finally {
      button.disabled = false;
      await checkDriverStatus();
    }
  });

  find('uninstallDriver').addEventListener('click', async () => {
    const button = find('uninstallDriver');
    button.disabled = true;
    setDriverStatus('Removing VoiceChanger Driver…', 'working');
    try {
      const result = await window.nativeAudio?.driverUninstall?.();
      if (!result?.ok) throw new Error(result?.output || 'Driver removal failed.');
      setDriverStatus('VoiceChanger Driver removal requested.', 'ok');
      appendDriverLog(result.output);
      try { find('refreshOutputs')?.click(); } catch {}
    } catch (error) {
      setDriverStatus(`Driver removal failed: ${error.message}`, 'bad');
      appendDriverLog(`DRIVER REMOVE ERROR: ${error.stack || error.message}`);
    } finally {
      button.disabled = false;
      await checkDriverStatus();
    }
  });

  find('refreshDriver').addEventListener('click', checkDriverStatus);
  find('routeDriver').addEventListener('click', async () => {
    const output = await selectVoiceChangerOutput({ requireDriver: true });
    if (!output) setDriverStatus('VoiceChanger virtual output was not found. Install the VoiceChanger Driver first.', 'bad');
  });
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
  if (!window.nativeAudio?.driverStatus) {
    setDriverStatus('Driver controls are unavailable in this build. Install the newest EXE.', 'bad');
    return;
  }
  setDriverStatus('Checking Windows audio devices…', 'working');
  try {
    const result = await window.nativeAudio.driverStatus();
    if (!result.supported) {
      setDriverStatus(result.output || 'Windows is required.', 'bad');
      return;
    }
    if (result.installed) {
      const output = await selectVoiceChangerOutput();
      if (!output) {
        setDriverStatus('✓ VoiceChanger virtual driver installed. Its Windows audio output is still registering.', 'working');
      }
    } else {
      setDriverStatus('VoiceChanger virtual audio driver is not installed.', 'bad');
    }
  } catch (error) {
    setDriverStatus(`Driver status failed: ${error.message}`, 'bad');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  addDriverCard();
  checkDriverStatus();
});