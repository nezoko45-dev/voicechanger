const find = (id) => document.getElementById(id);

function findVoiceChangerOutput(devices) {
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  return outputs.find((d) => /magic mic(?!.*microphone)|voicechanger|virtual audio driver|virtual.?audio|virtual.?speaker/i.test(d.label || '')) || null;
}

function findVoiceChangerInput(devices) {
  const inputs = devices.filter((d) => d.kind === 'audioinput');
  return inputs.find((d) => /magic mic.*microphone|magic mic|virtual mic driver|voicechanger/i.test(d.label || '')) || null;
}

async function enumerateMagicMic() {
  if (!navigator.mediaDevices?.enumerateDevices) return { output: null, input: null };
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return { output: findVoiceChangerOutput(devices), input: findVoiceChangerInput(devices) };
  } catch (error) {
    appendDriverLog(`MAGIC MIC DEVICE ENUMERATION ERROR: ${error.message}`);
    return { output: null, input: null };
  }
}

async function selectVoiceChangerOutput({ requireDriver = false } = {}) {
  const select = find('outputDevice');
  if (!select || !navigator.mediaDevices?.enumerateDevices) return null;
  try {
    const { output } = await enumerateMagicMic();
    if (!output) {
      if (requireDriver) appendDriverLog('Magic Mic virtual output is not visible yet. Windows may still be creating the virtual audio endpoint.');
      return null;
    }
    const option = [...select.options].find((item) => item.value === output.deviceId);
    if (!option) select.add(new Option(output.label || 'Magic Mic', output.deviceId));
    select.value = output.deviceId;
    localStorage.setItem('voicechanger.outputDevice', output.deviceId);
    setDriverStatus('✓ Magic Mic output is installed and selected. Its microphone endpoint is available to Discord/VRChat/etc.', 'ok');
    return output;
  } catch (error) {
    appendDriverLog(`MAGIC MIC OUTPUT ERROR: ${error.message}`);
    return null;
  }
}

function installMagicMicPlaybackRouter() {
  if (!window.nativeAudio?.playWavBase64 || window.nativeAudio.__magicMicRouterInstalled) return;
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
      appendDriverLog(`MAGIC MIC PLAYBACK ERROR: ${error.message}`);
      return nativeFallback(base64);
    }
  };
  window.nativeAudio.__magicMicRouterInstalled = true;
}

function addDriverCard() {
  if (find('driverCard')) return;
  const grid = document.querySelector('.grid');
  if (!grid) return;

  const card = document.createElement('div');
  card.id = 'driverCard';
  card.className = 'card wide';
  card.innerHTML = `
    <h2>🎛️ Magic Mic Virtual Audio</h2>
    <div class="stack">
      <div id="driverStatus" class="status working">Checking the Magic Mic virtual audio driver…</div>
      <div class="row">
        <button id="installDriver">Install Magic Mic Driver</button>
        <button id="uninstallDriver" class="danger">Remove Driver</button>
        <button id="refreshDriver" class="secondary">Refresh Driver Status</button>
        <button id="routeDriver" class="secondary">Route TTS Through Magic Mic</button>
      </div>
      <div class="hint">
        Pocket TTS is sent to the Magic Mic virtual speaker. Windows exposes the matching <b>Magic Mic Microphone</b> input so Discord, VRChat, OBS, games, and other apps can use the generated voice as their microphone.
      </div>
    </div>`;

  grid.insertBefore(card, grid.firstElementChild);

  find('installDriver').addEventListener('click', async () => {
    const button = find('installDriver');
    button.disabled = true;
    setDriverStatus('Installing the Magic Mic virtual audio driver…', 'working');
    try {
      const result = await window.nativeAudio?.driverInstall?.();
      if (!result?.ok && !result?.staged && !result?.reboot) throw new Error(result?.output || 'Driver installation failed.');
      appendDriverLog(result.output);
      if (result.reboot) {
        setDriverStatus('⚠ Windows Test Signing was enabled. Restart Windows once, then click Install Magic Mic Driver again.', 'working');
        appendDriverLog('RESTART REQUIRED: Windows Test Signing has been enabled so Magic Mic can start without Code 52.');
        return;
      }
      if (result.staged && !result.installed) {
        setDriverStatus('Driver package installed, but Windows has not exposed both Magic Mic endpoints yet. Refresh after Windows finishes device setup.', 'working');
      } else {
        setDriverStatus('✓ Magic Mic installed. Registering its speaker and microphone endpoints…', 'working');
      }
      try { find('refreshOutputs')?.click(); } catch {}
      setTimeout(() => { selectVoiceChangerOutput({ requireDriver: true }); }, 1200);
      setTimeout(() => { selectVoiceChangerOutput({ requireDriver: true }); }, 3000);
      setTimeout(() => { checkDriverStatus(); }, 5000);
    } catch (error) {
      setDriverStatus(`Driver install failed: ${error.message}`, 'bad');
      appendDriverLog(`DRIVER INSTALL ERROR: ${error.stack || error.message}`);
    } finally {
      button.disabled = false;
    }
  });

  find('uninstallDriver').addEventListener('click', async () => {
    const button = find('uninstallDriver');
    button.disabled = true;
    setDriverStatus('Removing Magic Mic Driver…', 'working');
    try {
      const result = await window.nativeAudio?.driverUninstall?.();
      if (!result?.ok) throw new Error(result?.output || 'Driver removal failed.');
      setDriverStatus('Magic Mic Driver removal requested.', 'ok');
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
    const devices = await enumerateMagicMic();
    const output = devices.output;
    if (!output) {
      setDriverStatus('Magic Mic virtual output was not found yet. Install the Magic Mic Driver first.', 'bad');
      return;
    }
    if (!devices.input) {
      setDriverStatus('Magic Mic output is present, but Windows has not exposed Magic Mic Microphone yet.', 'working');
      return;
    }
    await selectVoiceChangerOutput({ requireDriver: true });
    setDriverStatus('✓ TTS is routed to Magic Mic. Select “Magic Mic Microphone” as the microphone in Discord/VRChat/etc.', 'ok');
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
      const devices = await enumerateMagicMic();
      if (!devices.output) {
        setDriverStatus('✓ Magic Mic Driver is installed, but Windows has not exposed its virtual speaker yet.', 'working');
      } else if (!devices.input) {
        setDriverStatus('⚠ Magic Mic speaker is ready, but Magic Mic Microphone is not visible yet.', 'working');
      } else {
        await selectVoiceChangerOutput();
        setDriverStatus('✓ Magic Mic speaker + microphone are ready. TTS will flow into Magic Mic Microphone.', 'ok');
      }
      return;
    }
    if (result.reboot) {
      setDriverStatus('⚠ Windows restart is required to finish enabling Magic Mic.', 'working');
      return;
    }
    if (result.testsigningOff) {
      setDriverStatus('⚠ Magic Mic needs one Windows restart to enable its required driver mode. Click Install Magic Mic Driver to prepare it.', 'working');
      return;
    }
    if (result.staged) {
      setDriverStatus('Driver package is installed, but both Magic Mic endpoints are not created yet. Refresh Driver Status and try Install Magic Mic Driver again.', 'working');
      return;
    }
    setDriverStatus('Magic Mic virtual audio driver is not installed.', 'bad');
  } catch (error) {
    setDriverStatus(`Driver status failed: ${error.message}`, 'bad');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  installMagicMicPlaybackRouter();
  addDriverCard();
  checkDriverStatus();
});