const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { getUpdateCapabilities, createUpdateController } = require('../src/electron/appUpdater');

const tick = () => new Promise(resolve => setImmediate(resolve));
const installed = { canAutoInstall: true, canDownload: true };
const environment = {
  isPackaged: true, platform: 'win32', env: {}, execPath: 'D:\\Music\\Hydrogen Music.exe',
  isFile: file => file === 'D:\\Music\\Uninstall Hydrogen Music.exe',
};

function fixture({ capabilities = installed, enabled = true, saveTimeout = 1000 } = {}) {
  const updater = new EventEmitter();
  const messages = [];
  const installs = [];
  const requests = [];
  updater.downloadUpdate = token => new Promise((resolve, reject) => {
    requests.push({ token, resolve, reject });
    token.reject = reject;
  });
  updater.quitAndInstall = (...args) => installs.push(args);
  const controller = createUpdateController({
    updater, capabilities, saveTimeout,
    createToken: () => ({ cancelled: false, cancel() { this.cancelled = true; this.reject?.(new Error('cancelled')); } }),
    send: (channel, payload) => messages.push({ channel, payload }),
    setProgress: () => {}, isEnabled: async () => enabled,
  });
  updater.emit('update-available', { version: '9.0.0' });
  return { updater, controller, messages, installs, requests };
}

async function main() {
  assert.equal(getUpdateCapabilities(environment).canAutoInstall, true);
  for (const patch of [
    { isPackaged: false }, { isFile: () => false }, { platform: 'darwin' },
    { env: { PORTABLE_EXECUTABLE_DIR: 'D:\\Portable' } },
    { env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Portable.exe' } },
  ]) assert.equal(getUpdateCapabilities({ ...environment, ...patch }).canAutoInstall, false);

  const success = fixture();
  success.updater.emit('update-available', { version: '9.0.0', releaseNotes: '- 更新入口统一', releaseDate: '2026-10-12' });
  assert.equal(success.controller.getState().releaseNotes, '- 更新入口统一');
  assert.equal(success.controller.getState().releaseDate, '2026-10-12');
  const download = success.controller.download();
  success.controller.download();
  await tick();
  assert.equal(success.requests.length, 1, 'double clicks must not duplicate the download');
  assert.equal(success.updater.autoDownload, false);
  assert.equal(success.updater.autoInstallOnAppQuit, false);
  success.updater.emit('download-progress', { percent: 37.8 });
  assert.equal(success.controller.getState().progress, 38);
  success.requests[0].resolve(['setup.exe']);
  await download;
  await tick();
  assert.equal(success.controller.getState().status, 'installing');
  assert.equal(success.installs.length, 0, 'must wait for persisted playback before launching installer');
  const save = success.messages.find(message => message.channel === 'player-save').payload.updateRequestId;
  success.controller.playbackSaved('wrong-id');
  await tick();
  assert.equal(success.installs.length, 0);
  success.controller.playbackSaved(save);
  await tick();
  assert.deepEqual(success.installs, [[true, true]], 'Windows installation must be silent and restart');
  success.controller.download();
  assert.equal(success.requests.length, 1);

  const cancelled = fixture();
  const cancelledDownload = cancelled.controller.download();
  await tick();
  cancelled.controller.cancel();
  assert.equal(cancelled.requests[0].token.cancelled, true);
  assert.equal(cancelled.controller.getState().status, 'cancelling');
  cancelled.updater.emit('download-progress', { percent: 99 });
  await cancelledDownload;
  assert.equal(cancelled.controller.getState().status, 'available');
  assert.equal(cancelled.controller.getState().progress, 0);
  assert.equal(cancelled.installs.length, 0);
  assert.equal(cancelled.messages.some(message => message.channel === 'player-save'), false);

  const retry = cancelled.controller.download();
  await tick();
  assert.notEqual(cancelled.requests[1].token, cancelled.requests[0].token);
  cancelled.requests[1].reject(new Error('network offline'));
  await retry;
  assert.equal(cancelled.controller.getState().status, 'error');
  assert.equal(cancelled.controller.getState().error, 'network offline');

  const disabled = fixture({ enabled: false });
  await disabled.controller.download();
  assert.equal(disabled.requests.length, 0);
  assert.equal(disabled.controller.getState().status, 'error');

  const portable = fixture({ capabilities: { canAutoInstall: false, canDownload: false } });
  await portable.controller.download();
  await portable.controller.install();
  assert.equal(portable.requests.length, 0);
  assert.equal(portable.installs.length, 0);

  const timeout = fixture({ saveTimeout: 10 });
  const timedDownload = timeout.controller.download();
  await tick();
  timeout.requests[0].resolve(['setup.exe']);
  await timedDownload;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(timeout.controller.getState().status, 'error');
  assert.match(timeout.controller.getState().error, /保存播放状态超时/);
  const expired = timeout.messages.find(message => message.channel === 'player-save').payload.updateRequestId;
  timeout.controller.playbackSaved(expired);
  assert.equal(timeout.installs.length, 0, 'late save replies must never trigger installation');

  const linux = fixture({ capabilities: { canAutoInstall: false, canDownload: true } });
  const linuxDownload = linux.controller.download();
  await tick();
  linux.requests[0].resolve(['app.AppImage']);
  await linuxDownload;
  assert.equal(linux.controller.getState().status, 'ready');
  assert.equal(linux.installs.length, 0, 'other platforms retain explicit install confirmation');

  const revisions = success.messages.filter(message => message.channel === 'app-update-state').map(message => message.payload.revision);
  assert.ok(revisions.every((revision, index) => index === 0 || revision > revisions[index - 1]));
  console.log('app update checks passed (installation detection, single-flight, progress, cancellation, retry, save handshake, timeout, platform fallback)');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
