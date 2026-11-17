const assert = require('node:assert/strict');
const { createAutoLaunchController } = require('../src/electron/autoLaunch.cjs');
let enabled = false;
let calls = [];
const app = {
  isPackaged: true,
  getLoginItemSettings(options) { calls.push(['get', options]); return { openAtLogin: enabled }; },
  setLoginItemSettings(options) { calls.push(['set', options]); enabled = options.openAtLogin; },
};
for (const platform of ['win32', 'darwin']) {
  const controller = createAutoLaunchController(app, platform);
  assert.equal(controller.getState().enabled, false);
  assert.equal(controller.setEnabled(true).enabled, true);
  const options = calls.findLast(([type]) => type === 'set')[1];
  assert.equal(options.openAtLogin, true);
  if (platform === 'win32') {
    assert.equal(options.path, process.execPath);
    assert.deepEqual(options.args, []);
  }
  assert.equal(controller.setEnabled(false).enabled, false);
  assert.throws(() => controller.setEnabled('true'), TypeError);
  enabled = true;
  assert.equal(controller.getState().enabled, true, 'OS-side changes must be reflected');
  enabled = false;
}
for (const [isPackaged, platform] of [[false, 'win32'], [true, 'linux']]) {
  calls = [];
  const controller = createAutoLaunchController({ ...app, isPackaged }, platform);
  assert.equal(controller.getState().supported, false);
  assert.equal(controller.setEnabled(true).supported, false);
  assert.equal(calls.length, 0, 'Unsupported environments must not access system login items');
}
const denied = createAutoLaunchController({ ...app, setLoginItemSettings() {} }, 'win32');
assert.throws(() => denied.setEnabled(true), /系统未应用/);
const blocked = createAutoLaunchController({ ...app, getLoginItemSettings: () => ({ openAtLogin: true, executableWillLaunchAtLogin: false }) }, 'win32');
assert.equal(blocked.getState().enabled, false);
assert.throws(() => blocked.setEnabled(true), /系统未应用/);
const unavailable = createAutoLaunchController({ ...app, getLoginItemSettings() { throw new Error('denied'); } }, 'darwin');
assert.equal(unavailable.getState().supported, false);
console.log('开机自启检查通过：系统状态读写、双平台参数、开发环境保护、权限失败与系统禁用状态。');
