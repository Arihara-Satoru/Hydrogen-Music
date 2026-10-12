const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const RELEASE_URL = 'https://github.com/Arihara-Satoru/Hydrogen-Music/releases';

function getUpdateCapabilities({ isPackaged, platform, env, execPath, isFile }) {
  // ZIP builds are packaged too. Only an NSIS installation has the adjacent uninstaller.
  const installed = isPackaged && platform === 'win32' &&
    !env.PORTABLE_EXECUTABLE_DIR && !env.PORTABLE_EXECUTABLE_FILE &&
    isFile(path.win32.join(path.win32.dirname(execPath), 'Uninstall Hydrogen Music.exe'));
  return {
    canAutoInstall: Boolean(installed),
    canDownload: Boolean(installed || (isPackaged && platform === 'linux')),
    manualDownloadUrl: RELEASE_URL,
  };
}

function createUpdateController({ updater, createToken, capabilities, send, setProgress, isEnabled, saveTimeout = 10000 }) {
  let state = { ...capabilities, status: 'idle', version: '', progress: 0, error: '', revision: 0 };
  let downloadTask = null;
  let token = null;
  let installTask = null;
  let pendingSave = null;
  let autoInstall = false;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;

  const publish = (patch) => {
    state = { ...state, ...patch, revision: state.revision + 1 };
    send('app-update-state', { ...state });
  };
  const fail = (error) => {
    setProgress(-1);
    publish({ status: 'error', error: error?.message || String(error) });
  };
  const busy = () => Boolean(downloadTask || installTask || state.status === 'installing');
  const available = (info) => {
    if (busy()) return;
    publish({ status: 'available', version: info.version, progress: 0, error: '' });
  };
  updater.on('update-available', available);
  updater.on('update-not-available', () => {
    if (!busy()) publish({ status: 'latest', error: '' });
  });
  updater.on('download-progress', (info) => {
    if (!token || token.cancelled || state.status !== 'downloading') return;
    const progress = Math.max(0, Math.min(100, Math.round(info.percent || 0)));
    publish({ progress });
    setProgress(progress / 100);
  });
  // Download/check promise failures are handled by their caller. Install errors may be asynchronous.
  updater.on('error', (error) => {
    if (!downloadTask) fail(error);
  });

  const install = () => {
    if (installTask || !capabilities.canDownload || state.status !== 'ready') return installTask;
    installTask = Promise.resolve().then(async () => {
      if (!await isEnabled()) throw new Error('应用更新已关闭，请先在设置中开启');
      publish({ status: 'installing', error: '' });
      await new Promise((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => {
          pendingSave = null;
          reject(new Error('保存播放状态超时，请重试更新'));
        }, saveTimeout);
        pendingSave = { id, resolve: () => { clearTimeout(timer); pendingSave = null; resolve(); } };
        send('player-save', { updateRequestId: id });
      });
      updater.quitAndInstall(capabilities.canAutoInstall, true);
    }).catch(fail).finally(() => { installTask = null; });
    return installTask;
  };

  const download = () => {
    if (busy() || !capabilities.canDownload || !['available', 'error'].includes(state.status) || !state.version) return;
    // Reserve the operation before awaiting settings so double-clicks cannot start two downloads.
    token = createToken();
    const currentToken = token;
    autoInstall = capabilities.canAutoInstall;
    publish({ status: 'downloading', progress: 0, error: '' });
    downloadTask = Promise.resolve().then(async () => {
      if (!await isEnabled()) throw new Error('应用更新已关闭，请先在设置中开启');
      if (currentToken.cancelled) return;
      await updater.downloadUpdate(currentToken);
      if (!currentToken.cancelled) publish({ status: 'ready', progress: 100 });
    }).catch((error) => {
      if (!currentToken.cancelled) fail(error);
    }).finally(() => {
      setProgress(-1);
      downloadTask = null;
      token = null;
      if (currentToken.cancelled) publish({ status: 'available', progress: 0, error: '' });
      else if (autoInstall && state.status === 'ready') void install();
      autoInstall = false;
    });
    return downloadTask;
  };

  return {
    getState: () => ({ ...state }),
    busy,
    available,
    checking: () => { if (!busy()) publish({ status: 'checking', version: '', error: '' }); },
    latest: () => publish({ status: 'latest', version: '', error: '' }),
    fail,
    download,
    install,
    cancel: () => {
      if (!token || state.status !== 'downloading') return;
      autoInstall = false;
      publish({ status: 'cancelling' });
      token.cancel();
    },
    isSaveRequest: (id) => Boolean(pendingSave && pendingSave.id === id),
    playbackSaved: (id) => { if (pendingSave?.id === id) pendingSave.resolve(); },
  };
}

let controller;
let activeWindow;
function getAppUpdater(win, app) {
  activeWindow = win;
  if (controller) return controller;
  const { autoUpdater, CancellationToken } = require('electron-updater');
  const { getElectronStore } = require('./store');
  controller = createUpdateController({
    updater: autoUpdater,
    createToken: () => new CancellationToken(),
    capabilities: getUpdateCapabilities({
      isPackaged: app.isPackaged, platform: process.platform, env: process.env, execPath: app.getPath('exe'),
      isFile: (file) => { try { return fs.statSync(file).isFile(); } catch (_) { return false; } },
    }),
    send: (channel, payload) => {
      if (!activeWindow.isDestroyed() && !activeWindow.webContents.isDestroyed()) activeWindow.webContents.send(channel, payload);
    },
    setProgress: (value) => { if (!activeWindow.isDestroyed()) activeWindow.setProgressBar(value); },
    isEnabled: async () => {
      const Store = await getElectronStore();
      return new Store({ name: 'settings' }).get('settings')?.other?.enableUpdate !== false;
    },
  });
  return controller;
}

module.exports = { getUpdateCapabilities, createUpdateController, getAppUpdater };
