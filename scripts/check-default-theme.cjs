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
for (const [filename, id] of [['Selector', 'selector'], ['AudioRecognition', 'recognition'], ['base/BaseModal', 'modal']]) {
  const { descriptor: component } = parse(fs.readFileSync(path.join(root, `src/components/${filename}.vue`), 'utf8'));
  for (const style of component.styles) {
    const result = compileStyle({ source: style.content, filename: `${filename}.vue`, id: `data-v-${id}`, scoped: style.scoped, preprocessLang: style.lang });
    assert.deepEqual(result.errors, []);
    styles.push(result.code);
  }
}
const themeSource = fs.readFileSync(path.join(root, 'src/utils/dynamicTheme.js'), 'utf8').replace(/^export /gm, '');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>${css}\n${styles.join('\n')}\n* { transition: none !important; }</style><div class="mainWindow" data-v-default-theme></div><div class="selector-option" data-v-selector><div class="selector-option-item selector-option-item-selected" data-v-selector>选中</div></div><div class="recognition-panel" data-v-recognition></div><div class="modal-container" data-v-modal></div>`));
    await win.webContents.executeJavaScript(`${themeSource}; void 0`);
    const background = () => win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".mainWindow")).backgroundImage');
    const original = await background();
    const surfaces = () => win.webContents.executeJavaScript(`Object.fromEntries(['.selector-option', '.recognition-panel', '.modal-container', '.selector-option-item-selected'].map(selector => { const style = getComputedStyle(document.querySelector(selector)); return [selector, { background: style.background, color: style.color }]; }))`);
    const lightSurfaces = await surfaces();
    assert.match(lightSurfaces['.selector-option'].background, /rgba\(190, 217, 223, 0.96\)/, 'Dropdowns must use the blue panel token');
    assert.match(lightSurfaces['.recognition-panel'].background, /linear-gradient/, 'Recognition must use the opaque blue surface gradient');
    assert.equal(lightSurfaces['.recognition-panel'].background, lightSurfaces['.modal-container'].background, 'Recognition and common modals must share their default surface');
    assert.equal(lightSurfaces['.selector-option-item-selected'].color, 'rgb(255, 255, 255)', 'Selected option text must remain white');
    assert.equal(original, 'linear-gradient(rgba(176, 209, 217, 0.9) -20%, rgba(176, 209, 217, 0.4) 50%, rgba(176, 209, 217, 0.9) 120%)', 'Default light theme must retain the historical pale-blue gradient');
    await win.webContents.executeJavaScript('applyCustomTheme("#d06040")');
    assert.notEqual(await background(), original, 'Custom theme must override the default gradient');
    const warmSurfaces = await surfaces();
    for (const selector of ['.selector-option', '.recognition-panel', '.modal-container']) {
      assert.notEqual(warmSurfaces[selector].background, lightSurfaces[selector].background, `${selector} must follow the active palette`);
      assert.notEqual(warmSurfaces[selector].background, await background(), `${selector} must differ from the main backdrop`);
    }
    await win.webContents.executeJavaScript('applyCustomTheme("#4080d0")');
    const coolSurfaces = await surfaces();
    for (const selector of ['.selector-option', '.recognition-panel', '.modal-container']) {
      assert.notEqual(coolSurfaces[selector].background, warmSurfaces[selector].background, `${selector} must update when the palette changes`);
    }
    await win.webContents.executeJavaScript('clearDynamicTheme({ persist: false })');
    assert.equal(await background(), original, 'Disabling dynamic color or resetting custom color must restore the default gradient');
    assert.deepEqual(await surfaces(), lightSurfaces, 'Reset must also restore overlay surfaces');
    await win.webContents.executeJavaScript('document.documentElement.classList.add("dark")');
    const dark = await background();
    assert.match((await surfaces())['.recognition-panel'].background, /rgb\(33, 38, 43\)/, 'Recognition must retain the dark background');
    assert.notEqual(dark, original, 'Dark mode must retain its own background');
    await win.webContents.executeJavaScript('applyPalette({ hue: 30, saturation: 60 }, { persist: false })');
    const darkWarmSurfaces = await surfaces();
    await win.webContents.executeJavaScript('applyPalette({ hue: 220, saturation: 60 }, { persist: false })');
    const darkCoolSurfaces = await surfaces();
    for (const selector of ['.selector-option', '.recognition-panel', '.modal-container']) {
      assert.notEqual(darkCoolSurfaces[selector].background, darkWarmSurfaces[selector].background, `${selector} must follow the dark palette`);
      assert.notEqual(darkCoolSurfaces[selector].background, await background(), `${selector} must remain distinct in dark mode`);
    }
    assert.notEqual((await surfaces())['.recognition-panel'].background, lightSurfaces['.recognition-panel'].background, 'Recognition must retain its dynamic palette override');
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
