const find = (id) => document.getElementById(id);

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
      </div>
      <div class="hint">
        Installs a Windows virtual speaker + virtual microphone endpoint for routing the cloned voice into VoiceMeeter, ChilloutVR, OBS, or other apps. Windows will request administrator permission during installation.
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
      setDriverStatus('✓ VoiceChanger Driver installed. Refresh Windows audio devices if needed.', 'ok');
      appendDriverLog(result.output);
      try { find('refreshOutputs')?.click(); } catch {}
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
      setDriverStatus('✓ VoiceChanger virtual audio driver detected.', 'ok');
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
