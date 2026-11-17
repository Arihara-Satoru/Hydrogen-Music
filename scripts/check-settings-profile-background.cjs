// Run with: pnpm exec electron scripts/check-settings-profile-background.cjs
// Render the real card styles against a high-contrast image to detect unmasked edges.
const { app, BrowserWindow } = require('electron');
const { readFileSync } = require('node:fs');
const { compileString } = require('sass');
const assert = require('node:assert/strict');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1000, height: 700, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  try {
    const source = readFileSync(require.resolve('../src/views/Settings.vue'), 'utf8');
    const style = source.match(/<style scoped lang="scss">([\s\S]*?)<\/style>/)[1];
    const css = compileString(style).css;
    await win.loadURL('about:blank');
    await win.webContents.executeJavaScript(`
      document.body.innerHTML = '<div class="settings-page"><div class="settings-container"><div class="settings-user-info"></div></div></div>';
      document.head.appendChild(document.createElement('style')).textContent = ${JSON.stringify(css)};
      document.head.appendChild(document.createElement('style')).textContent = 
        'body { margin: 0; --panel: white; --border: transparent; --shadow: none; }' +
        '.settings-page .settings-container { padding: 20px; width: auto; height: auto; }' +
        '.settings-user-info { box-sizing: border-box; height: 340px; }';
      const card = document.querySelector('.settings-user-info');
      const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="200"><path fill="red" d="M0 0h1000v200H0z"/></svg>');
      // An opaque diagnostic overlay makes any uncovered image pixel unambiguous.
      card.style.backgroundImage = 'linear-gradient(105deg, white, white), url("' + image + '")';
    `);
    const uncoveredPixels = async () => {
      const bounds = await win.webContents.executeJavaScript(`
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
          const rect = document.querySelector('.settings-user-info').getBoundingClientRect();
          resolve({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        })))
      `);
      const image = await win.webContents.capturePage();
      const { width, height } = image.getSize();
      const viewport = await win.webContents.executeJavaScript('({ width: innerWidth, height: innerHeight })');
      const sx = width / viewport.width;
      const sy = height / viewport.height;
      const pixels = image.toBitmap();
      let red = 0;
      for (let y = Math.floor(bounds.y * sy); y < Math.ceil((bounds.y + bounds.height) * sy); y++) {
        for (let x = Math.floor(bounds.x * sx); x < Math.ceil((bounds.x + bounds.width) * sx); x++) {
          const offset = (y * width + x) * 4;
          if (pixels[offset + 2] > pixels[offset + 1] + 25) red++;
        }
      }
      return red;
    };
    // Prove the fixture reproduces the original padding-box mismatch.
    await win.webContents.executeJavaScript("card.style.backgroundOrigin = 'padding-box'");
    assert.ok(await uncoveredPixels() > 0, 'original background origin must expose image edges');
    await win.webContents.executeJavaScript("card.style.removeProperty('background-origin')");
    for (const zoom of [1, 1.25, 1.5]) {
      win.webContents.setZoomFactor(zoom);
      assert.equal(await uncoveredPixels(), 0, `overlay must cover every image pixel at zoom ${zoom}`);
    }
    console.log('Settings profile background checks passed (original reproduced; fixed at 100%, 125%, 150%).');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
