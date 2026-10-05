const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const registered = new Map();
const blocked = new Set();
const globalShortcut = {
  unregisterAll: () => registered.clear(),
  register: (key, callback) => {
    if (registered.has(key) || blocked.has(key)) return false;
    registered.set(key, callback);
    return true;
  },
};
const settings = {
  shortcuts: [
    ['play', 'P'], ['last', 'Left'], ['next', 'Right'],
    ['volumeUp', 'Up'], ['volumeDown', 'Down'],
    ['processForward', ']'], ['processBack', '['],
  ].map(([id, key]) => ({
    id,
    shortcut: `CommandOrControl+${key}`,
    globalShortcut: `CommandOrControl+Alt+${key}`,
  })),
  other: { globalShortcuts: true },
};
class Store {
  get(key) { return key.split('.').slice(1).reduce((value, part) => value?.[part], settings); }
  set(key, value) { settings[key.split('.').at(-1)] = value; }
}
const moduleMock = { exports: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '../src/electron/shortcuts.js'), 'utf8'),
  {
    module: moduleMock,
    require: (name) => name === 'electron'
      ? { Menu: { buildFromTemplate: (template) => template, setApplicationMenu: () => {} }, globalShortcut }
      : { getElectronStore: async () => Store },
    console,
    process,
  },
);
const win = { webContents: { send: (...args) => { win.lastCommand = args; }, openDevTools: () => {} } };

const settingsSource = fs.readFileSync(path.join(__dirname, '../src/views/Settings.vue'), 'utf8');
const inputSource = settingsSource.match(/const inputShortcut = \(k\) => \{[\s\S]*?\n\};/)?.[0];
assert(inputSource, 'shortcut input handler exists');
const capture = {
  selectedShortcut: { value: { id: 'play', type: true } },
  shortcutsList: { value: settings.shortcuts },
  shortcutCharacter: [],
};
vm.runInNewContext(`${inputSource}\nthis.inputShortcut = inputShortcut;`, capture);
capture.inputShortcut({
  code: 'KeyM', key: 'm', ctrlKey: true, altKey: true,
  shiftKey: false, metaKey: false, repeat: false,
  preventDefault() {},
});
assert.equal(settings.shortcuts[0].globalShortcut, 'Control+Alt+M');
settings.shortcuts[0].globalShortcut = 'CommandOrControl+Alt+P';

const ipcSource = fs.readFileSync(path.join(__dirname, '../src/electron/ipcMain.js'), 'utf8');
const normalizeSource = ipcSource.match(/function normalizeStoredSettings\([\s\S]*?\r?\n}\r?\n/)?.[0];
assert(normalizeSource, 'settings normalization exists');
const normalization = {
  normalizeMusicSettings: (value) => value,
  normalizeDirectoryPath: (value) => value,
  normalizeDirectoryList: (value) => value || [],
};
vm.runInNewContext(`${normalizeSource}\nthis.normalizeStoredSettings = normalizeStoredSettings;`, normalization);
const migrated = normalization.normalizeStoredSettings({
  shortcuts: [
    { id: 'play', globalShortcut: 'Control+P' },
    { id: 'last', globalShortcut: 'CommandOrControl+Alt+Left' },
  ],
});
assert.equal(migrated.shortcuts[0].globalShortcut, 'Control+P');
assert.equal(migrated.shortcuts[1].globalShortcut, 'CommandOrControl+Shift+Left');
assert.equal(migrated.other.shortcutDefaultsShiftV1, true);
assert.equal(normalization.normalizeStoredSettings({
  ...migrated,
  shortcuts: [{ id: 'last', globalShortcut: 'CommandOrControl+Alt+Left' }],
}).shortcuts[0].globalShortcut, 'CommandOrControl+Alt+Left');

(async () => {
  await moduleMock.exports(win);
  assert(registered.has('CommandOrControl+Alt+P'));
  settings.shortcuts[0].globalShortcut = 'CommandOrControl+Alt+M';
  await moduleMock.exports(win);
  assert(!registered.has('CommandOrControl+Alt+P'));
  registered.get('CommandOrControl+Alt+M')();
  assert.deepEqual(win.lastCommand, ['music-playing-control']);
  settings.other.globalShortcuts = false;
  await moduleMock.exports(win);
  assert(!registered.has('CommandOrControl+Alt+M'));
  settings.other.globalShortcuts = true;
  settings.shortcuts[0].globalShortcut = 'CommandOrControl+Alt+P';
  blocked.add('CommandOrControl+Alt+P');
  await moduleMock.exports(win);
  assert.equal(win.lastCommand[0], 'shortcut-registration-failures');
  assert.equal(win.lastCommand[1][0].id, 'play');
  console.log('Shortcut defaults, capture, remap, disable and conflict warning: OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
