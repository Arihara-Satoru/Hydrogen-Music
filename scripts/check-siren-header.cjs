// Run with: pnpm exec electron scripts/check-siren-header.cjs
const { app, BrowserWindow } = require('electron');
const { readFileSync } = require('node:fs');
const { compileString } = require('sass');
const { compileStyle } = require('@vue/compiler-sfc');
const assert = require('node:assert/strict');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 900 });
  try {
    const source = readFileSync(require.resolve('../src/views/SirenPage.vue'), 'utf8');
    assert.doesNotMatch(source, /:global\([^\n]*(?:\.mainWindow|\.globalWidget|\.home-header|\.home-content)/);
    const { resolveAppShellLayout } = await import('../src/utils/appShellLayout.mjs');
    const appSource = readFileSync(require.resolve('../src/App.vue'), 'utf8');
    assert.match(appSource, /resolveAppShellLayout\(route.name, playerStore.widgetState\)/);
    assert.doesNotMatch(appSource, /:has\([^\n]*siren-page/);
    const style = source.match(/<style scoped lang="scss">([\s\S]*?)<\/style>/)[1];
    const compiled = compileStyle({ source: compileString(style).css, id: 'data-v-siren-test', scoped: true });
    assert.deepEqual(compiled.errors, []);
    const css = compiled.code + readFileSync(require.resolve('../src/assets/css/appShell.css'), 'utf8');
    await win.loadURL('data:text/html,' + encodeURIComponent(`<!doctype html>
      <style>body{margin:0}.mainWindow{position:relative;height:100vh;overflow:hidden}.home-content{overflow:auto}</style>
      <div id="app"><div class="mainWindow shell-siren"><div class="home-content">
      <section class="siren-page" data-v-siren-test><div class="stage-mark" data-v-siren-test></div><div style="height:2500px">Albums</div></section>
      </div></div></div>`));
    await win.webContents.insertCSS(css);
    for (const width of [1400, 700]) {
      win.setSize(width, 900);
      for (const dark of [false, true]) {
        const result = await win.webContents.executeJavaScript(`(() => {
          document.documentElement.classList.toggle('dark', ${dark});
          document.querySelector('.home-content').scrollTop = 500;
          const style = getComputedStyle(document.querySelector('.mainWindow'), '::before');
          return { height: style.height, background: style.backgroundColor,
            zIndex: style.zIndex, pointerEvents: style.pointerEvents,
            scrollTop: document.querySelector('.home-content').scrollTop };
        })()`);
        assert.equal(result.height, width === 700 ? '132px' : '78px');
        assert.equal(result.background, dark ? 'rgb(8, 10, 11)' : 'rgb(242, 242, 240)');
        assert.equal(result.zIndex, '999');
        assert.equal(result.pointerEvents, 'none');
        assert.equal(result.scrollTop, 500);
        const hidden = await win.webContents.executeJavaScript(`(() => {
          const main = document.querySelector('.mainWindow');
          main.classList.remove('shell-siren');
          const content = getComputedStyle(main, '::before').content;
          main.classList.add('shell-siren');
          return content;
        })()`);
        assert.equal(hidden, 'none', '播放器打开时不能保留塞壬顶栏背板');
        for (const [route, widgetState, expected] of [
          ['siren', true, true], ['siren', false, false], ['siren', true, true],
          ['sirenAlbum', true, true], ['sirenAlbum', false, false],
          ['homepage', true, false], ['personalfm', true, false],
        ]) {
          const layout = resolveAppShellLayout(route, widgetState);
          assert.equal(layout.siren, expected);
          const content = await win.webContents.executeJavaScript(`(() => {
            const main = document.querySelector('.mainWindow');
            main.classList.toggle('shell-siren', ${layout.siren});
            return getComputedStyle(main, '::before').content;
          })()`);
          assert.equal(content, expected ? '""' : 'none', `${route}, widgetState=${widgetState}`);
        }
        await win.webContents.executeJavaScript("document.querySelector('.mainWindow').classList.add('shell-siren')");
      }
    }
    console.log('Siren header checks passed: desktop/mobile, light/dark, scroll, list/player/return and route changes.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
