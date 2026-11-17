// Run: node scripts/check-default-theme.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow } = require('electron');
const { parse, compileStyle } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '..');
const { descriptor } = parse(fs.readFileSync(path.join(root, 'src/App.vue'), 'utf8'));
const css = fs.readFileSync(path.join(root, 'src/assets/css/theme.css'), 'utf8');
const styles = descriptor.styles.map(style => {
  const result = compileStyle({ source: style.content, filename: 'App.vue', id: 'data-v-default-theme', scoped: style.scoped, preprocessLang: 'scss' });
  assert.deepEqual(result.errors, []);
  return result.code;
});
const themeSource = fs.readFileSync(path.join(root, 'src/utils/dynamicTheme.js'), 'utf8').replace(/^export /gm, '');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>${css}\n${styles.join('\n')}\n* { transition: none !important; }</style><div class="mainWindow" data-v-default-theme></div>`));
    await win.webContents.executeJavaScript(`${themeSource}; void 0`);
    const background = () => win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".mainWindow")).backgroundImage');
    const original = await background();
    assert.equal(original, 'linear-gradient(rgba(176, 209, 217, 0.9) -20%, rgba(176, 209, 217, 0.4) 50%, rgba(176, 209, 217, 0.9) 120%)', 'Default light theme must retain the historical pale-blue gradient');
    await win.webContents.executeJavaScript('applyCustomTheme("#d06040")');
    assert.notEqual(await background(), original, 'Custom theme must override the default gradient');
    await win.webContents.executeJavaScript('clearDynamicTheme({ persist: false })');
    assert.equal(await background(), original, 'Disabling dynamic color or resetting custom color must restore the default gradient');
    await win.webContents.executeJavaScript('document.documentElement.classList.add("dark")');
    const dark = await background();
    assert.notEqual(dark, original, 'Dark mode must retain its own background');
    await win.webContents.executeJavaScript('applyPalette({ hue: 30, saturation: 60 }, { persist: false })');
    assert.notEqual(await background(), dark, 'Dynamic palette must still override the dark background');
    await win.webContents.executeJavaScript('clearDynamicTheme({ persist: false })');
    assert.equal(await background(), dark, 'Disabling dynamic color in dark mode must restore the dark background');
    console.log('Default theme regression checks passed.');
  } finally {
    win.destroy();
    app.quit();
  }
}).catch(error => {
  console.error(error);
  app.exit(1);
});
