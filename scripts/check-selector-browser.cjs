// Run with: npm exec -- electron scripts/check-selector-browser.cjs
// Owns an isolated Vite server; never occupies the application's dev port 5173.
const { app, BrowserWindow } = require('electron');
const { readFileSync } = require('node:fs');
const { compileString } = require('sass');
const assert = require('node:assert/strict');

app.whenReady().then(async () => {
  let server;
  const win = new BrowserWindow({
    width: 1100, height: 720, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  try {
    const { createServer } = await import('vite');
    server = await createServer({ server: { host: '127.0.0.1', port: 5179, strictPort: true } });
    await server.listen();
    await win.loadURL('http://127.0.0.1:5179/scripts/fixtures/selector.html');
    const settings = readFileSync(require.resolve('../src/views/Settings.vue'), 'utf8');
    const style = settings.match(/<style scoped lang="scss">([\s\S]*?)<\/style>/)[1];
    await win.webContents.insertCSS(compileString(style).css);
    const result = await win.webContents.executeJavaScript(`(async () => {
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const check = () => {
          if (document.querySelectorAll('.selector').length === 2) resolve();
          else if (Date.now() > deadline) reject(new Error('Selector fixture did not mount: ' + document.body.innerText));
          else setTimeout(check, 20);
        };
        check();
      });
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const settle = async () => {
        await frame();
        await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
      };
      const container = document.querySelector('.settings-container');
      const triggers = [...document.querySelectorAll('.selector')];
      const menus = [...document.querySelectorAll('.selector-option')];
      const rootFits = () => document.documentElement.scrollHeight === innerHeight;
      const checks = {};
      triggers[0].click();
      await settle();
      checks.qualityNoScrollbar = menus[0].scrollHeight === menus[0].clientHeight;
      checks.flushBottomEdge = Math.abs(menus[0].getBoundingClientRect().top - triggers[0].getBoundingClientRect().bottom) < 1;
      checks.visibleHeadFlushBottom = Math.abs(menus[0].getBoundingClientRect().top - triggers[0].querySelector('.selector-head').getBoundingClientRect().bottom) < 1;
      checks.headFitsTrigger = triggers[0].querySelector('.selector-head').getBoundingClientRect().height === triggers[0].getBoundingClientRect().height;
      checks.noBlankPadding = getComputedStyle(menus[0]).paddingTop === '0px';
      checks.rootFitsWithQuality = rootFits();
      const before = menus[0].getBoundingClientRect().top;
      container.scrollTop += 30;
      await frame();
      checks.followsScroll = Math.abs(menus[0].getBoundingClientRect().top - before + 30) < 1;
      triggers[0].click();
      await settle();
      for (let i = 0; i < 30; i++) { triggers[0].click(); await frame(); }
      await settle();
      checks.onlyTwoMenus = document.querySelectorAll('.selector-option').length === 2;
      container.scrollTop = 200;
      await frame();
      triggers[1].click();
      await settle();
      checks.sizeScrollable = menus[1].scrollHeight > menus[1].clientHeight;
      checks.rootFitsWithSize = rootFits();
      checks.alignedWidth = Math.abs(menus[1].getBoundingClientRect().width - triggers[1].getBoundingClientRect().width) < 1;
      container.scrollTop += 500;
      await frame();
      await settle();
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 2000;
        const check = () => {
          if (getComputedStyle(menus[1]).display === 'none') resolve();
          else if (Date.now() > deadline) reject(new Error('Offscreen menu remained visible'));
          else setTimeout(check, 20);
        };
        check();
      });
      checks.offscreenClosed = triggers[1].getAttribute('aria-expanded') === 'false' && getComputedStyle(menus[1]).display === 'none';
      container.scrollTop = 0;
      await frame();
      triggers[1].click();
      await settle();
      checks.opensAbove = menus[1].dataset.placement === 'top';
      checks.flushTopEdge = Math.abs(menus[1].getBoundingClientRect().bottom - triggers[1].getBoundingClientRect().top) < 1;
      checks.insideContent = menus[1].getBoundingClientRect().top >= container.getBoundingClientRect().top;
      document.documentElement.classList.add('dark');
      checks.darkPanel = getComputedStyle(menus[1]).backgroundColor !== 'rgba(255, 255, 255, 0.9)';
      return checks;
    })()`);
    console.log(result);
    for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, name);
    console.log('Chromium selector rendering checks passed.');
    await server.close();
    app.exit(0);
  } catch (error) {
    console.error(error);
    await server?.close();
    app.exit(1);
  }
});
